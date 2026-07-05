import type { BusKind } from '@shared/types/events.js';
import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export interface EventRow {
  id: number;
  kind: string;
  payload: string;
  source_id: string | null;
  observed_at: string | null;
  occurred_at: string | null;
  published_at: string;
}

export interface RecordedEvent {
  id: number;
  kind: BusKind;
  payload: unknown;
  published_at: string;
}

export function makeEventsRepo(db: Db) {
  const stmt = makeStatementCache(db);

  return {
    /**
     * Insert an audit row and return its auto-incremented id.
     * Synchronous on purpose — the bus calls this before delivering.
     */
    recordEvent(
      kind: BusKind,
      payload: unknown,
      meta: {
        source_id?: string;
        observed_at?: string;
        occurred_at?: string;
        published_at: string;
      },
    ): number {
      const result = stmt(
        `INSERT INTO events (kind, payload, source_id, observed_at, occurred_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        kind,
        JSON.stringify(payload ?? null),
        meta.source_id ?? null,
        meta.observed_at ?? null,
        meta.occurred_at ?? null,
        meta.published_at,
      );
      return Number(result.lastInsertRowid);
    },

    /**
     * Fetch events strictly greater than `cursorId`, optionally filtered to specific kinds.
     */
    eventsSince(cursorId: number, kinds?: BusKind[]): EventRow[] {
      if (!kinds || kinds.length === 0) {
        return stmt('SELECT * FROM events WHERE id > ? ORDER BY id ASC').all(cursorId) as EventRow[];
      }
      const placeholders = kinds.map(() => '?').join(',');
      return db
        .prepare(
          `SELECT * FROM events WHERE id > ? AND kind IN (${placeholders}) ORDER BY id ASC`,
        )
        .all(cursorId, ...kinds) as EventRow[];
    },

    getCursor(name: string): number {
      const row = stmt(
        'SELECT last_event_id FROM event_subscriber_cursors WHERE subscriber_name = ?',
      ).get(name) as { last_event_id: number } | undefined;
      return row?.last_event_id ?? 0;
    },

    advanceCursor(name: string, lastEventId: number, updatedAt: string): void {
      stmt(
        `INSERT INTO event_subscriber_cursors (subscriber_name, last_event_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(subscriber_name) DO UPDATE SET last_event_id = excluded.last_event_id, updated_at = excluded.updated_at`,
      ).run(name, lastEventId, updatedAt);
    },

    latestEventId(): number {
      const row = stmt('SELECT MAX(id) AS m FROM events').get() as { m: number | null };
      return row?.m ?? 0;
    },

    /**
     * Look up events by their `source_id`. Returns at most one row per id.
     * Used by the citation pipeline to render `*[email: Marcus, May 19 16:42]*`
     * style markers on diary components from their `supporting_artifact_ids[]`.
     */
    lookupBySourceIds(sourceIds: readonly string[]): EventRow[] {
      if (sourceIds.length === 0) return [];
      const placeholders = sourceIds.map(() => '?').join(',');
      return db
        .prepare(
          `SELECT * FROM events WHERE source_id IN (${placeholders}) ORDER BY id ASC`,
        )
        .all(...sourceIds) as EventRow[];
    },
  };
}
