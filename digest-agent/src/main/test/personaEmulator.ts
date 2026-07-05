/**
 * In-process persona emulator — test mode only.
 *
 * Reads `../persona-generator/data/personas/<slug>/persona.db` (sibling repo,
 * auto-detected relative to digest-agent's cwd) and streams emails +
 * calendar_ops + notes onto the bus as `webhook.persona` events in
 * `occurred_at` order at a configurable rate.
 *
 * Replaces the Python `persona-gen serve` CLI + HTTPS POST round-trip — both
 * now live here so a single `npm start` with the right env vars drives the
 * whole loop with no network involved.
 *
 * Contract preserved verbatim from the deleted persona-emulator webhook
 * adapter so downstream consumers (mind dispatcher, persona-clock driver)
 * see the same shape they always did.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Bus } from '../bus.js';
import { mkSourceId } from '@shared/types/ids.js';
import type { WebhookEventPayload } from '@shared/types/events.js';

// ─── Path resolution ────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to a persona's sqlite DB.
 *
 * persona-generator writes to `<myrico-root>/data/personas/<slug>/persona.db`
 * (NOT inside its own repo dir). From digest-agent's perspective that's a
 * sibling: `<cwd>/../data/personas/<slug>/persona.db`.
 *
 * Throws if the file does not exist — the caller (boot.ts in test mode) wants
 * a loud failure here, not a fallback to "well let's just emit nothing".
 */
export function resolvePersonaDbPath(slug: string, cwd: string = process.cwd()): string {
  const path = resolve(cwd, '..', 'data', 'personas', slug, 'persona.db');
  if (!existsSync(path)) {
    throw new Error(
      `persona DB not found at ${path}. ` +
        `Generate it first: cd ../persona-generator && uv run persona-gen generate run ${slug}`,
    );
  }
  return path;
}

// ─── Reader ─────────────────────────────────────────────────────────────────

export type ArtifactKind = 'email' | 'calendar_event' | 'note';

export interface PersonaRow {
  occurred_at: string;
  kind: ArtifactKind;
  row: Record<string, unknown>;
}

/**
 * Read every email / calendar_op / note from the persona DB, merge them into a
 * single occurred_at-sorted list, and return it.
 *
 * Loads the whole timeline at once — persona DBs are small (a few hundred
 * rows), so streaming complexity isn't worth it. Equivalent to the Python
 * `reader.stream_events`.
 */
export function readPersonaTimeline(dbPath: string): PersonaRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const emails = db
      .prepare('SELECT * FROM emails ORDER BY date_iso')
      .all() as Record<string, unknown>[];
    const calops = db
      .prepare('SELECT * FROM calendar_ops ORDER BY ts_iso')
      .all() as Record<string, unknown>[];
    const notes = db
      .prepare('SELECT * FROM notes ORDER BY created_iso')
      .all() as Record<string, unknown>[];

    const merged: PersonaRow[] = [];
    for (const row of emails) {
      merged.push({ occurred_at: row['date_iso'] as string, kind: 'email', row });
    }
    for (const row of calops) {
      merged.push({ occurred_at: row['ts_iso'] as string, kind: 'calendar_event', row });
    }
    for (const row of notes) {
      merged.push({ occurred_at: row['created_iso'] as string, kind: 'note', row });
    }

    merged.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
    return merged;
  } finally {
    db.close();
  }
}

// ─── Payload conversion ─────────────────────────────────────────────────────

export interface ToWebhookOptions {
  idPrefix?: string;
  now: () => string;
}

/**
 * Convert a persona.db row into the `WebhookEventPayload` shape the bus
 * carries. Mirrors the Python `payload.to_webhook` + the deleted
 * `normalizePersonaEmulatorEvent` adapter in one step.
 *
 * `x_synth_*` columns (persona-gen's internal eval metadata) are dropped.
 */
/**
 * Decode a JSON-encoded string[] column. persona-gen stores empty CC lists as
 * the literal JSON string `"null"` (which parses to JS null), so we
 * normalize null → []. Anything that isn't null or an array throws loud —
 * a malformed column is a real data bug worth surfacing, not papering over.
 */
function parseAddrList(raw: unknown, fieldName: string): string[] {
  // Three "no entries" idioms persona-gen actually uses, all map to []:
  //   - SQL NULL → JS null
  //   - empty string ""
  //   - JSON null literal '"null"' → parses to JS null
  if (raw === null || raw === undefined || raw === '') return [];
  if (typeof raw !== 'string') {
    throw new Error(`${fieldName}: expected string column, got ${typeof raw}`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null) return [];
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName}: JSON did not parse to an array (got ${typeof parsed}): ${raw}`);
  }
  return parsed as string[];
}

export function toWebhookEvent(
  slug: string,
  pr: PersonaRow,
  opts: ToWebhookOptions,
): WebhookEventPayload {
  const { idPrefix, now } = opts;
  let artifactId: string;
  let identity: string[];
  let data: Record<string, unknown>;

  if (pr.kind === 'email') {
    const r = pr.row;
    artifactId = r['message_id'] as string;
    const to = parseAddrList(r['to_addrs_json'], 'to_addrs_json');
    const cc = parseAddrList(r['cc_addrs_json'], 'cc_addrs_json');
    identity = [r['from_addr'] as string, ...to, ...cc];
    data = {
      from: r['from_addr'],
      to,
      cc,
      subject: r['subject'],
      body: r['body'],
      in_reply_to: r['in_reply_to'] ?? null,
      thread_id: r['thread_id'] ?? null,
    };
  } else if (pr.kind === 'calendar_event') {
    const r = pr.row;
    artifactId = `calop:${r['op_id']}`;
    identity = [];
    data = {
      op: r['op'],
      event_id: r['event_id'],
      payload: JSON.parse(r['payload_json'] as string),
      linked_message_id: r['linked_message_id'] ?? null,
    };
  } else {
    const r = pr.row;
    artifactId = r['note_id'] as string;
    identity = [];
    data = {
      filename: r['filename'],
      title: r['title'] ?? null,
      body: r['body'],
    };
  }

  const stableId = idPrefix ? `${idPrefix}:${artifactId}` : artifactId;

  return {
    id: mkSourceId(`persona:${slug}:${pr.kind}:${stableId}`),
    source: 'persona-emulator',
    observed_at: now(),
    occurred_at: pr.occurred_at,
    identity_handles: identity,
    payload: {
      type: pr.kind,
      persona: slug,
      data,
    },
  };
}

// ─── Rate parsing ───────────────────────────────────────────────────────────

/** Returns the interval (ms) between posts. `'burst'` means zero delay. */
export function parseRate(rate: string): number {
  if (rate === 'burst') return 0;
  const [nStr, unit] = rate.split('/');
  if (unit !== 'sec') {
    throw new Error(`--rate must be '<N>/sec' or 'burst' (got '${rate}')`);
  }
  const n = Number(nStr);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--rate count must be a positive number (got '${rate}')`);
  }
  return 1000 / n;
}

// ─── Driver ─────────────────────────────────────────────────────────────────

export interface PersonaEmulatorOptions {
  slug: string;
  /** `'<N>/sec'` or `'burst'`. */
  rate: string;
  /** Override clock for testing payload `observed_at` timestamps. */
  now?: () => string;
  /** Inject the timeline instead of reading from disk. Used by tests. */
  timeline?: PersonaRow[];
  /** Override DB path resolution. */
  dbPath?: string;
  /** Optional id-namespace prefix (rerun-safety vs digest-agent's dedup cache). */
  idPrefix?: string;
  /**
   * Drop events whose `occurred_at` is strictly before this date. Used by
   * boot.ts to honor `DIGEST_TEST_PERSONA_SKIP_DAYS` — the early events still
   * exist on disk (substrate can MCP into them) but never hit the bus.
   */
  skipBefore?: Date;
  /**
   * Drop events whose `occurred_at` is at or after this date. Used by boot.ts
   * to honor `DIGEST_TEST_PERSONA_MAX_DAYS` — caps the tail of the timeline.
   */
  skipAfter?: Date;
  /** Override the sleep function. Used by tests to advance fake timers. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * STRICT-SEQUENCING dispatchers. When provided, the emulator orchestrates
   * the run as: cold-start → wait drain → for each persona-day → advance
   * clock to that day's 06:00 (in the persona's local timezone, captured
   * from event timestamps) → fire diary tick → wait drain → stream that
   * day's events (each with intra-event bus drain) → wait mind drain → next
   * day. Without these, the emulator falls back to the flat-streaming
   * behavior used by unit tests.
   */
  strictSequence?: {
    /** AdjustableClock the emulator advances to morning-of-day before each diary fire. */
    clock: import('../clock.js').AdjustableClock;
    /** Awaited before any event streams. */
    coldStart: { whenIdle(): Promise<void> };
    /** Awaited between days to ensure all events have been processed. */
    mind: { whenIdle(): Promise<void> };
    /** Awaited after each diary fire so we don't stream the next day's events on top. */
    diary: { whenIdle(): Promise<void> };
  };
}

export interface PersonaEmulator {
  /** Start streaming. Resolves when the timeline is fully drained. */
  start(): Promise<void>;
  /** Request cancellation. Already-fired events still settle on the bus. */
  stop(): void;
  /** Diagnostic — count emitted so far. */
  emitted(): number;
}

export function createPersonaEmulator(
  bus: Bus,
  opts: PersonaEmulatorOptions,
): PersonaEmulator {
  const intervalMs = parseRate(opts.rate);
  const now = opts.now ?? (() => new Date().toISOString());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rawTimeline =
    opts.timeline ?? readPersonaTimeline(opts.dbPath ?? resolvePersonaDbPath(opts.slug));
  const beforeMs = opts.skipBefore?.getTime();
  const afterMs = opts.skipAfter?.getTime();
  const timeline = rawTimeline.filter((r) => {
    const t = new Date(r.occurred_at).getTime();
    if (beforeMs !== undefined && t < beforeMs) return false;
    if (afterMs !== undefined && t >= afterMs) return false;
    return true;
  });
  const skipped = rawTimeline.length - timeline.length;

  let emitted = 0;
  let stopped = false;

  async function emitOne(pr: PersonaRow): Promise<void> {
    const event = toWebhookEvent(opts.slug, pr, {
      now,
      ...(opts.idPrefix !== undefined ? { idPrefix: opts.idPrefix } : {}),
    });
    await bus.emit('webhook.persona', event, {
      source_id: event.id,
      observed_at: event.observed_at,
      occurred_at: event.occurred_at,
    });
    // Per-event drain so mind invocations queue in order — see legacy note
    // below. (Production webhook routes don't drain; this coupling is
    // emulator-only.)
    await bus.whenDrained();
    emitted++;
  }

  /**
   * Group rows by their **persona-local date** — slice the ISO offset string
   * directly so the date matches the persona's timezone, not UTC.
   */
  function groupByPersonaDay(rows: PersonaRow[]): Map<string, PersonaRow[]> {
    const out = new Map<string, PersonaRow[]>();
    for (const r of rows) {
      const day = r.occurred_at.slice(0, 10);
      const list = out.get(day) ?? [];
      list.push(r);
      out.set(day, list);
    }
    return out;
  }

  /**
   * 06:00 in the persona's local timezone, preserving the offset from the
   * persona's data. Used by strict sequencing to advance the clock to
   * morning-of-day before each diary fire.
   */
  function personaMorning(day: string, sampleOccurredAt: string): Date {
    // sampleOccurredAt is like "2026-05-14T13:00:00-07:00" — extract the offset.
    const m = /([+-]\d{2}:\d{2}|Z)$/.exec(sampleOccurredAt);
    const offset = m ? m[1] : 'Z';
    return new Date(`${day}T06:00:00${offset}`);
  }

  async function runFlat(): Promise<void> {
    const range: string[] = [];
    if (opts.skipBefore) range.push(`from ${opts.skipBefore.toISOString()}`);
    if (opts.skipAfter) range.push(`until ${opts.skipAfter.toISOString()}`);
    console.log(
      `[persona-emulator] flat-streaming ${timeline.length} artifacts for ${opts.slug} ` +
        `at ${opts.rate} (interval=${intervalMs}ms)` +
        (skipped > 0 ? ` — filtered out ${skipped} events ${range.join(' ')}` : ''),
    );
    for (let i = 0; i < timeline.length; i++) {
      if (stopped) break;
      await emitOne(timeline[i]!);
      if (intervalMs > 0 && i < timeline.length - 1) {
        await sleep(intervalMs);
      }
    }
    console.log(`[persona-emulator] finished — emitted ${emitted} events`);
  }

  /**
   * Add `days` days to a YYYY-MM-DD persona-local date. Used to compute the
   * "morning of next day" diary fire-time after each day's events drain.
   */
  function addDaysIso(day: string, deltaDays: number): string {
    const [y, m, d] = day.split('-').map((n) => parseInt(n, 10));
    const dt = new Date(Date.UTC(y!, m! - 1, d! + deltaDays));
    return dt.toISOString().slice(0, 10);
  }

  async function runStrictSequence(): Promise<void> {
    const seq = opts.strictSequence!;
    // 1. Wait for cold-start to fully drain before any event leaves the
    //    emulator. Boot.ts already awaits fireWithRetry before starting us,
    //    but keep this as defense-in-depth.
    console.log('[persona-emulator] strict sequence: awaiting cold-start drain…');
    await seq.coldStart.whenIdle();
    console.log('[persona-emulator] cold-start drained — beginning day-by-day stream');

    if (stopped) return;
    const byDay = groupByPersonaDay(timeline);
    const days = Array.from(byDay.keys()).sort();

    // The contract: for each persona-day N, stream all of day-N's events
    // (with intra-event drains so mind invocations serialize), wait for the
    // mind queue to fully drain, then advance the simulated clock to 06:00
    // PT of day N+1 and fire the morning-of-day-(N+1) diary. The diary
    // reflects accumulated substrate through end-of-day-N. After it drains,
    // proceed to day N+1's events.
    for (const day of days) {
      if (stopped) break;
      const dayRows = byDay.get(day)!;
      console.log(
        `[persona-emulator] streaming ${dayRows.length} event(s) for ${day}`,
      );
      for (let i = 0; i < dayRows.length; i++) {
        if (stopped) break;
        await emitOne(dayRows[i]!);
        if (intervalMs > 0 && i < dayRows.length - 1) {
          await sleep(intervalMs);
        }
      }
      // Wait for every event of this day to be fully processed by mind.
      await seq.mind.whenIdle();
      console.log(`[persona-emulator] mind drained for ${day}; firing next-morning diary`);

      // Advance to 06:00 PT of day N+1 and fire the morning diary that
      // covers day N's matters.
      const nextDay = addDaysIso(day, 1);
      const morning = personaMorning(nextDay, dayRows[0]!.occurred_at);
      if (seq.clock.now().getTime() < morning.getTime()) {
        await seq.clock.advanceTo(morning);
      }
      console.log(
        `[persona-emulator] firing morning diary for ${nextDay} (sim ${morning.toISOString()})`,
      );
      await bus.emit('schedule.diary_tick', { trigger_at: morning.toISOString() });
      await bus.whenDrained();
      await seq.diary.whenIdle();
      console.log(`[persona-emulator] diary for ${nextDay} drained`);
    }
    console.log(
      `[persona-emulator] finished — emitted ${emitted} events across ${days.length} day(s)`,
    );
  }

  return {
    async start() {
      if (opts.strictSequence) {
        await runStrictSequence();
      } else {
        await runFlat();
      }
    },
    stop() {
      stopped = true;
    },
    emitted() {
      return emitted;
    },
  };
}
