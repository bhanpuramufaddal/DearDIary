/**
 * External event relay.
 *
 * Polls `pending_bus_events` every `intervalMs` (default 200ms). For each row,
 * calls `bus.emit(kind, payload)` (which records the event in the audit log
 * and delivers to subscribers), then deletes the relay row.
 *
 * The polling latency is acceptable for the surface MCP's usage pattern
 * (interactive principal actions; not the high-throughput webhook path).
 * If polling becomes a bottleneck, a Unix-socket-based emit channel between
 * the surface MCP and main is the natural upgrade — the pending_bus_events
 * table stays as a fallback / queue-on-disk for crash recovery.
 *
 * Architecture: design/11-backend-architecture.md § "Subsystem 11: surface MCP".
 */

import { makePendingEventsRepo } from '../db/pendingEvents.js';
import type { Bus } from '../bus.js';
import type { Db } from '../db/index.js';
import type { BusKind, BusEvent } from '@shared/types/events.js';

const DEFAULT_INTERVAL_MS = 200;
const DRAIN_BATCH = 32;

export interface EventRelay {
  start(): void;
  stop(): void;
  /** Drain queue immediately; used by tests. */
  drainNow(): Promise<number>;
}

export interface EventRelayOptions {
  intervalMs?: number;
  now?: () => string;
}

/**
 * Names of every BusKind. Used to validate inbound `kind` strings from the
 * relay queue — if a malformed row sneaks in, we drop it rather than crash.
 */
const VALID_KINDS: ReadonlySet<BusKind> = new Set<BusKind>([
  'webhook.persona',
  'webhook.gmail',
  'webhook.gcal',
  'reminder.fired',
  'schedule.diary_tick',
  'profile.changed',
  'diary.comment.added',
  'diary.note.added',
  'task.fired',
  'task.completed',
  'task.failed',
  'mind.invocation.done',
  'diary.invocation.done',
  'coldstart.invocation.done',
  'tunnel.up',
  'tunnel.down',
]);

export function createEventRelay(
  db: Db,
  bus: Bus,
  opts: EventRelayOptions = {},
): EventRelay {
  const pending = makePendingEventsRepo(db);
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let draining = false;

  async function drain(): Promise<number> {
    if (draining) return 0;
    draining = true;
    let total = 0;
    try {
      // Drain in small batches to keep individual ticks responsive.
      while (!stopped) {
        const rows = pending.drainOldest(DRAIN_BATCH);
        if (rows.length === 0) break;
        for (const row of rows) {
          if (!VALID_KINDS.has(row.kind as BusKind)) {
            console.warn(`[event-relay] dropping unknown kind: ${row.kind}`);
            pending.deleteById(row.id);
            continue;
          }
          try {
            const payload = JSON.parse(row.payload) as BusEvent['payload'];
            await bus.emit(row.kind as BusKind, payload, {
              ...(row.source_id ? { source_id: row.source_id } : {}),
              observed_at: row.written_at,
              occurred_at: row.written_at,
            });
          } catch (err) {
            console.error(`[event-relay] emit failed for kind=${row.kind}:`, err);
            // Continue; deletion still happens so a poison-pill row doesn't loop forever.
          }
          pending.deleteById(row.id);
          total++;
        }
      }
    } finally {
      draining = false;
    }
    return total;
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      await drain().catch((err: unknown) =>
        console.error('[event-relay] drain error:', err),
      );
      schedule();
    }, intervalMs);
  }

  return {
    start() {
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    drainNow: drain,
  };
}
