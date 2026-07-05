/**
 * persona-calendar MCP tools.
 *
 * Test-mode stand-in for a real Google Calendar MCP. Backs onto persona.db's
 * `calendar_ops` table — each row is one operation (create/update/cancel)
 * on a calendar event. Serves BOTH live queries ("ops in the last 24 hours")
 * AND historical snapshots ("the calendar state on May 1") via flexible
 * date-range filters.
 *
 * In production this would be replaced by the user's real Calendar MCP.
 */

import { z, type ZodTypeAny } from 'zod';
import Database from 'better-sqlite3';

export type PersonaDb = Database.Database;

export interface PersonaCalendarToolContext {
  personaDb: PersonaDb;
  now: () => string;
}

export interface PersonaCalendarTool<I extends ZodTypeAny = ZodTypeAny, O = unknown> {
  name: string;
  description: string;
  input: I;
  handler: (args: z.infer<I>, ctx: PersonaCalendarToolContext) => O | Promise<O>;
}

export function defineTool<I extends ZodTypeAny, O>(spec: {
  name: string;
  description: string;
  input: I;
  handler: (args: z.infer<I>, ctx: PersonaCalendarToolContext) => O | Promise<O>;
}): PersonaCalendarTool<I, O> {
  return spec;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPersonaCalendarTool = PersonaCalendarTool<z.ZodType<any, any, any>, unknown>;

// ─── helpers ────────────────────────────────────────────────────────────────

interface CalOpRow {
  op_id: number;
  ts_iso: string;
  op: string;
  event_id: string;
  source: string;
  linked_message_id: string | null;
  payload_json: string;
}

function rowToOp(r: CalOpRow): {
  op_id: number;
  occurred_at: string;
  op: string;
  event_id: string;
  source: string;
  linked_message_id: string | null;
  payload: unknown;
} {
  return {
    op_id: r.op_id,
    occurred_at: r.ts_iso,
    op: r.op,
    event_id: r.event_id,
    source: r.source,
    linked_message_id: r.linked_message_id,
    payload: JSON.parse(r.payload_json),
  };
}

function escapeLikePattern(q: string): string {
  return `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`;
}

// ─── tool: list_operations ──────────────────────────────────────────────────

export const listOperations = defineTool({
  name: 'list_operations',
  description:
    "List calendar operations (create/update/cancel) in a flexible window. Each op carries its payload (title, start, attendees, location). For a date-range historical query, set both `since` and `until`. Default order is occurred_at ASC.",
  input: z
    .object({
      since: z.string().datetime({ offset: true }).optional(),
      until: z.string().datetime({ offset: true }).optional(),
      op: z
        .enum(['create', 'update', 'cancel'])
        .optional()
        .describe("Filter by operation kind."),
      order: z.enum(['asc', 'desc']).default('asc'),
      limit: z.number().int().positive().max(500).default(100),
    })
    .strict(),
  handler: (args, ctx) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (args.since) {
      clauses.push('ts_iso >= ?');
      params.push(args.since);
    }
    if (args.until) {
      clauses.push('ts_iso < ?');
      params.push(args.until);
    }
    if (args.op) {
      clauses.push('op = ?');
      params.push(args.op);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const orderSql = args.order === 'desc' ? 'DESC' : 'ASC';
    const sql = `SELECT op_id, ts_iso, op, event_id, source, linked_message_id, payload_json
                 FROM calendar_ops ${where}
                 ORDER BY ts_iso ${orderSql}
                 LIMIT ?`;
    params.push(args.limit);
    const rows = ctx.personaDb.prepare(sql).all(...params) as CalOpRow[];
    return {
      window: { since: args.since ?? null, until: args.until ?? null },
      count: rows.length,
      operations: rows.map(rowToOp),
    };
  },
});

// ─── tool: list_events ──────────────────────────────────────────────────────

export const listEvents = defineTool({
  name: 'list_events',
  description:
    "List the latest known state of each event whose most-recent op falls in the window. This is the 'snapshot' view (one row per event_id) — distinct from list_operations which shows every state change. Cancelled events are included with `op: 'cancel'`; filter them out client-side if you only want active.",
  input: z
    .object({
      since: z.string().datetime({ offset: true }).optional(),
      until: z.string().datetime({ offset: true }).optional(),
      with: z
        .string()
        .max(120)
        .optional()
        .describe("Filter by an attendee substring (matches anything in the JSON payload)."),
      limit: z.number().int().positive().max(500).default(100),
    })
    .strict(),
  handler: (args, ctx) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (args.since) {
      clauses.push('ts_iso >= ?');
      params.push(args.since);
    }
    if (args.until) {
      clauses.push('ts_iso < ?');
      params.push(args.until);
    }
    if (args.with) {
      clauses.push("payload_json LIKE ? ESCAPE '\\'");
      params.push(escapeLikePattern(args.with));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    // Pick the latest op per event_id within the window.
    const sql = `WITH latest AS (
                   SELECT event_id, MAX(op_id) AS op_id
                     FROM calendar_ops ${where}
                    GROUP BY event_id
                 )
                 SELECT c.op_id, c.ts_iso, c.op, c.event_id, c.source,
                        c.linked_message_id, c.payload_json
                   FROM calendar_ops c
                   JOIN latest l ON l.op_id = c.op_id
                  ORDER BY c.ts_iso ASC
                  LIMIT ?`;
    params.push(args.limit);
    const rows = ctx.personaDb.prepare(sql).all(...params) as CalOpRow[];
    return {
      window: { since: args.since ?? null, until: args.until ?? null },
      count: rows.length,
      events: rows.map(rowToOp),
    };
  },
});

// ─── tool: get_event ────────────────────────────────────────────────────────

export const getEvent = defineTool({
  name: 'get_event',
  description:
    'Fetch the full op-history for one event_id, oldest-first. Returns every create/update/cancel that touched the event.',
  input: z.object({ event_id: z.string().min(1) }).strict(),
  handler: (args, ctx) => {
    const rows = ctx.personaDb
      .prepare(
        `SELECT op_id, ts_iso, op, event_id, source, linked_message_id, payload_json
           FROM calendar_ops
          WHERE event_id = ?
          ORDER BY ts_iso ASC`,
      )
      .all(args.event_id) as CalOpRow[];
    if (rows.length === 0) throw new Error(`event not found: ${args.event_id}`);
    return {
      event_id: args.event_id,
      count: rows.length,
      operations: rows.map(rowToOp),
    };
  },
});

// ─── tool: search_events ────────────────────────────────────────────────────

export const searchEvents = defineTool({
  name: 'search_events',
  description:
    'Substring search across event payloads (titles, descriptions, attendees). Case-insensitive.',
  input: z
    .object({
      query: z.string().min(1).max(200),
      max: z.number().int().positive().max(100).default(20),
    })
    .strict(),
  handler: (args, ctx) => {
    const pattern = escapeLikePattern(args.query);
    const rows = ctx.personaDb
      .prepare(
        `SELECT op_id, ts_iso, op, event_id, source, linked_message_id, payload_json
           FROM calendar_ops
          WHERE payload_json LIKE ? ESCAPE '\\'
          ORDER BY ts_iso DESC
          LIMIT ?`,
      )
      .all(pattern, args.max) as CalOpRow[];
    return { query: args.query, count: rows.length, operations: rows.map(rowToOp) };
  },
});

// ─── exports ────────────────────────────────────────────────────────────────

export const personaCalendarTools = {
  [listOperations.name]: listOperations,
  [listEvents.name]: listEvents,
  [getEvent.name]: getEvent,
  [searchEvents.name]: searchEvents,
} as unknown as Record<string, AnyPersonaCalendarTool>;

export const personaCalendarToolNames: readonly string[] = Object.keys(personaCalendarTools);
