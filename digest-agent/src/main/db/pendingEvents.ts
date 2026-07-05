/**
 * Pending-bus-events queue.
 *
 * Out-of-process writers (the surface MCP server) enqueue here; main's relay
 * subsystem (src/main/dispatcher/eventRelay.ts) drains by emitting on the
 * in-process bus and deleting the row.
 */

import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export interface PendingEventRow {
  id: number;
  kind: string;
  payload: string;
  source_id: string | null;
  written_at: string;
}

export function makePendingEventsRepo(db: Db) {
  const stmt = makeStatementCache(db);

  return {
    enqueue(kind: string, payload: unknown, source_id: string | null, writtenAt: string): number {
      const res = stmt(
        'INSERT INTO pending_bus_events (kind, payload, source_id, written_at) VALUES (?, ?, ?, ?)',
      ).run(kind, JSON.stringify(payload ?? null), source_id, writtenAt);
      return Number(res.lastInsertRowid);
    },

    drainOldest(limit: number): PendingEventRow[] {
      return stmt(
        'SELECT * FROM pending_bus_events ORDER BY id ASC LIMIT ?',
      ).all(limit) as PendingEventRow[];
    },

    deleteById(id: number): void {
      stmt('DELETE FROM pending_bus_events WHERE id = ?').run(id);
    },

    /** For tests + diagnostics. */
    count(): number {
      const row = stmt('SELECT COUNT(*) AS n FROM pending_bus_events').get() as { n: number };
      return row.n;
    },
  };
}
