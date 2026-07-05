/**
 * Event bus — in-process pub/sub, audit-first, with durable cursor subscribers.
 *
 * Architecture: design/11-backend-architecture.md § "Event bus".
 *
 * Properties:
 *  - Every emit() inserts a row in `events` BEFORE delivering to subscribers.
 *    The audit table is the source of truth; even if every subscriber crashes,
 *    the event is durably recorded.
 *  - emit() returns AS SOON AS the audit row is written. Subscribers are
 *    dispatched by a single internal worker promise loop that drains queued
 *    events in FIFO order. This decouples producer latency (webhook arrival,
 *    emulator tick) from consumer latency (slow agent invocations).
 *  - Subscribers run in registration order, awaited sequentially per event.
 *    A slow handler delays the next subscriber but never gets bypassed.
 *  - Durable subscribers track their last-processed event id in
 *    `event_subscriber_cursors`. After crash + restart, `replayDurableSubscribers()`
 *    re-delivers any events past each durable cursor — at-least-once with cursor
 *    advance after success means exactly-once in practice.
 *  - A handler exception against a durable subscriber halts that subscriber for
 *    the current event (cursor doesn't advance, so it retries on next replay);
 *    other subscribers still see the event.
 *  - Re-entrant emits (a handler calls bus.emit) just enqueue and are picked up
 *    after the current event finishes — no recursion, no depth limit.
 *
 * What this bus is NOT:
 *  - Cross-process. The substrate / surface MCP servers are subprocesses with
 *    their own SQLite connections. They write rows; the main process polls or
 *    relays via a separate channel. See design/11 § "Subsystem 14: event bus"
 *    and § "Subsystem 11: surface MCP server".
 *  - Sharded / concurrent across handlers for a single emit. Handlers are
 *    sequenced on purpose; concurrency would defeat the cursor semantics.
 */

import { makeEventsRepo, type EventRow } from './db/events.js';
import type { Db } from './db/index.js';
import type { BusKind, PayloadOf } from '@shared/types/events.js';

type WildcardKind = '*';
type SubscribeKind = BusKind | WildcardKind;

export interface EmitMeta {
  /** Optional source id to record in the audit row (e.g. `gmail:msg_abc`). */
  source_id?: string;
  /** When the main process observed the source event. */
  observed_at?: string;
  /** When the event actually happened in the source's clock. */
  occurred_at?: string;
}

export interface HandlerMeta {
  id: number;
  kind: BusKind;
}

export type Handler<K extends BusKind> = (
  payload: PayloadOf<K>,
  meta: HandlerMeta,
) => Promise<void> | void;

export interface SubscribeOptions {
  /** Durable subscribers have their cursor persisted in `event_subscriber_cursors`. */
  durable?: boolean;
  /** Required when `durable` is true. Identifies the cursor row. */
  name?: string;
}

interface Subscriber {
  kind: SubscribeKind;
  handler: (payload: unknown, meta: HandlerMeta) => Promise<void> | void;
  durable: boolean;
  name?: string;
}

interface QueuedEvent {
  kind: BusKind;
  payload: unknown;
  id: number;
}

export interface BusOptions {
  /** Stub for tests: override the clock used for `published_at` and cursor `updated_at`. */
  now?: () => string;
}

export class Bus {
  private readonly subscribers: Subscriber[] = [];
  private readonly events: ReturnType<typeof makeEventsRepo>;
  private readonly now: () => string;
  private readonly queue: QueuedEvent[] = [];
  private worker: Promise<void> | null = null;

  constructor(db: Db, opts: BusOptions = {}) {
    this.events = makeEventsRepo(db);
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /**
   * Subscribe to a specific event kind, or to `'*'` for every event.
   *
   * Durable subscribers (`opts.durable === true`) require a unique `name`.
   * Their handler's success advances a cursor in `event_subscriber_cursors`,
   * and `replayDurableSubscribers()` re-delivers anything past the cursor on boot.
   */
  on<K extends BusKind>(kind: K, handler: Handler<K>, opts?: SubscribeOptions): void;
  on(kind: WildcardKind, handler: Handler<BusKind>, opts?: SubscribeOptions): void;
  on(kind: SubscribeKind, handler: Handler<BusKind>, opts: SubscribeOptions = {}): void {
    if (opts.durable && !opts.name) {
      throw new Error('durable subscribers must have a name');
    }
    if (opts.durable && this.subscribers.some((s) => s.durable && s.name === opts.name)) {
      throw new Error(`durable subscriber name already registered: ${opts.name}`);
    }
    this.subscribers.push({
      kind,
      handler: handler as Subscriber['handler'],
      durable: opts.durable === true,
      name: opts.name,
    });
  }

  /**
   * Emit an event.
   *
   * Synchronous-ish steps:
   *  1. Records an audit row in `events`.
   *  2. Pushes the event onto the internal queue.
   *  3. Kicks the worker (no-op if already running).
   *  4. Returns. Subscribers will be invoked by the worker, NOT inline.
   *
   * Returns a Promise to keep the API call-shape stable (and to allow future
   * back-pressure semantics), but it resolves as soon as the audit row exists.
   */
  emit<K extends BusKind>(
    kind: K,
    payload: PayloadOf<K>,
    meta: EmitMeta = {},
  ): Promise<void> {
    const publishedAt = this.now();
    const eventId = this.events.recordEvent(kind, payload, {
      source_id: meta.source_id ?? undefined,
      observed_at: meta.observed_at ?? undefined,
      occurred_at: meta.occurred_at ?? undefined,
      published_at: publishedAt,
    });
    this.queue.push({ kind, payload, id: eventId });
    this.kickWorker();
    return Promise.resolve();
  }

  /**
   * Returns a Promise that resolves when the worker is idle and the queue is empty.
   * Useful for tests and for shutdown sequencing. Idempotent.
   */
  whenDrained(): Promise<void> {
    if (!this.worker) return Promise.resolve();
    return this.worker.then(() =>
      // If new emits arrived while we were waiting for the worker, recurse.
      this.queue.length > 0 || this.worker ? this.whenDrained() : undefined,
    );
  }

  /**
   * Replay any events past each durable subscriber's cursor.
   *
   * Called at boot, after all subscribers are registered, before the bus
   * begins accepting fresh emits. Delivers in order, awaits each handler,
   * advances cursor on success. If a handler throws, replay stops for that
   * subscriber; the next boot picks up where this one left off.
   */
  async replayDurableSubscribers(): Promise<void> {
    const durable = this.subscribers.filter((s) => s.durable && s.name);
    for (const sub of durable) {
      const cursor = this.events.getCursor(sub.name!);
      const kinds = sub.kind === '*' ? undefined : [sub.kind as BusKind];
      const rows = this.events.eventsSince(cursor, kinds);
      for (const row of rows) {
        // Stored payloads are JSON written by recordEvent. Bad JSON here means
        // either DB corruption or a bug — surface it loudly rather than silently
        // delivering null to subscribers.
        const payload = JSON.parse(row.payload) as unknown;
        await sub.handler(payload, { id: row.id, kind: row.kind as BusKind });
        this.events.advanceCursor(sub.name!, row.id, this.now());
      }
    }
  }

  /** Returns a snapshot of registered subscribers — for diagnostics and tests. */
  describeSubscribers(): { kind: SubscribeKind; durable: boolean; name?: string }[] {
    return this.subscribers.map((s) => ({ kind: s.kind, durable: s.durable, name: s.name }));
  }

  /** Current queue depth — diagnostic. */
  queueDepth(): number {
    return this.queue.length;
  }

  // ─── Worker loop ───────────────────────────────────────────────────────

  private kickWorker(): void {
    if (this.worker) return;
    // Defer to a microtask so emit() returns BEFORE any subscriber runs, even
    // if the handlers are synchronous. Otherwise an `await` inside the worker's
    // synchronous body wouldn't yield until *after* the sync handler executes.
    this.worker = Promise.resolve()
      .then(() => this.run())
      .finally(() => {
        this.worker = null;
        // If new events were queued during the gap between the worker's while
        // loop exiting and this .finally running, kickWorker calls during that
        // gap were no-ops (this.worker was still set). Catch them here.
        if (this.queue.length > 0) this.kickWorker();
      });
  }

  private async run(): Promise<void> {
    while (this.queue.length > 0) {
      const ev = this.queue.shift()!;
      for (const sub of this.subscribers) {
        if (sub.kind !== '*' && sub.kind !== ev.kind) continue;
        let handlerFailed = false;
        try {
          await sub.handler(ev.payload, { id: ev.id, kind: ev.kind });
        } catch (err) {
          handlerFailed = true;
          console.error(
            `[bus] subscriber ${sub.name ?? '<anon>'} failed on ${ev.kind}:`,
            err,
          );
        }
        // Durable cursor advances only if the handler succeeded. If it failed,
        // the cursor stays — replay on next boot will retry.
        if (!handlerFailed && sub.durable && sub.name) {
          this.events.advanceCursor(sub.name, ev.id, this.now());
        }
      }
    }
  }
}

// Re-export for convenience in callers.
export type { BusEvent, BusKind, PayloadOf } from '@shared/types/events.js';
export type { EventRow };
