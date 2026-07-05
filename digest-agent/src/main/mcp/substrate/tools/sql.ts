/**
 * run_sql — the single READ access tool.
 *
 * Read-only for every role. Mutations throw at the SQLite layer because the
 * tool always uses the readonly connection (`ctx.roDb`). Writes to the mind
 * model go through the typed tools (`create_anchor`, `update_anchor_layer`,
 * `create_relationship`, `create_prediction`, the `support_*_precision` /
 * `contradict_*_precision` family, `set_reminder`, `cite`, ...) — those use
 * the read-write `ctx.db` handle.
 *
 * The architectural commitment: SQL is great for reads (joins, filters,
 * projections, dedup queries). Writes are a small set of repeated operations
 * with strict invariants (ID generation, FK ordering, atomic multi-step
 * transactions) — those reward typing, not free-form composition.
 */

import { z } from 'zod';
import { defineTool, type ToolContext } from '../tool.js';
import type { Db } from '../../../db/index.js';

function connectionFor(ctx: ToolContext): Db {
  if (!ctx.roDb) {
    throw new Error('run_sql requires a read-only connection (roDb) — server misconfigured');
  }
  return ctx.roDb;
}

export const runSql = defineTool({
  name: 'run_sql',
  description:
    "Run one READ-ONLY SQL statement against the substrate. SELECT / WITH / PRAGMA / EXPLAIN — anything that returns rows. INSERT / UPDATE / DELETE throw at the SQLite layer because the connection is opened readonly; for mind-model writes, use the typed tools (create_anchor, update_anchor_layer, create_relationship, create_prediction, set_reminder, cite, the support_*_precision / contradict_*_precision family, etc.). The schema is documented in the `substrate-schema` playbook. Use `params` (named `:name`/`$name`/`@name` or positional `?`) instead of string-concatenating values. Returns `{ rows, row_count }`.",
  input: z
    .object({
      sql: z.string().min(1).max(20000).describe('A single read-only SQL statement.'),
      params: z
        .union([z.array(z.unknown()), z.record(z.unknown())])
        .optional()
        .describe('Bound parameters: an array for positional `?`, or an object for named binds.'),
    })
    .strict(),
  handler: (args, ctx) => {
    const conn = connectionFor(ctx);
    const stmt = conn.prepare(args.sql);
    // better-sqlite3 wants either spread positional args or a single named-binds object.
    const bind = (run: (...a: unknown[]) => unknown): unknown => {
      if (args.params === undefined) return run();
      if (Array.isArray(args.params)) return run(...args.params);
      return run(args.params);
    };
    const rows = bind((...a: unknown[]) => stmt.all(...a)) as unknown[];
    return { rows, row_count: rows.length };
  },
});

export const sqlTools = {
  [runSql.name]: runSql,
};
