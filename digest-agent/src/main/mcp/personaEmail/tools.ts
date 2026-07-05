/**
 * persona-email MCP tools.
 *
 * Test-mode stand-in for a real Gmail MCP. Backs onto persona.db's `emails`
 * table. Serves BOTH live queries ("emails in the last 24 hours") AND
 * historical snapshots ("emails between Apr 24 and May 14") so the cold-start,
 * diary, and mind agents can use a single MCP surface across both regimes.
 *
 * In production, this server would be replaced by the user's real Gmail MCP
 * via `agent_mcp_access`. The cold-start / diary / mind agent prompts use
 * tool shapes that map cleanly to standard Gmail MCP surfaces.
 */

import { z, type ZodTypeAny } from 'zod';
import Database from 'better-sqlite3';

export type PersonaDb = Database.Database;

export interface PersonaEmailToolContext {
  personaDb: PersonaDb;
  /** Override clock — substrate's --clock-anchor is forwarded. */
  now: () => string;
}

export interface PersonaEmailTool<I extends ZodTypeAny = ZodTypeAny, O = unknown> {
  name: string;
  description: string;
  input: I;
  handler: (args: z.infer<I>, ctx: PersonaEmailToolContext) => O | Promise<O>;
}

export function defineTool<I extends ZodTypeAny, O>(spec: {
  name: string;
  description: string;
  input: I;
  handler: (args: z.infer<I>, ctx: PersonaEmailToolContext) => O | Promise<O>;
}): PersonaEmailTool<I, O> {
  return spec;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPersonaEmailTool = PersonaEmailTool<z.ZodType<any, any, any>, unknown>;

// ─── helpers ────────────────────────────────────────────────────────────────

function parseAddrList(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  if (typeof raw !== 'string') {
    throw new Error(`address column: expected string, got ${typeof raw}`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null) return [];
  if (!Array.isArray(parsed)) {
    throw new Error(`address column: JSON did not parse to an array: ${raw}`);
  }
  return parsed as string[];
}

interface EmailRow {
  message_id: string;
  thread_id: string | null;
  from_addr: string;
  to_addrs_json: string;
  cc_addrs_json: string | null;
  subject: string;
  date_iso: string;
  in_reply_to: string | null;
  body: string;
}

function rowToSummary(r: EmailRow): {
  message_id: string;
  thread_id: string | null;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  occurred_at: string;
  in_reply_to: string | null;
  body_excerpt: string;
} {
  return {
    message_id: r.message_id,
    thread_id: r.thread_id,
    from: r.from_addr,
    to: parseAddrList(r.to_addrs_json),
    cc: parseAddrList(r.cc_addrs_json),
    subject: r.subject,
    occurred_at: r.date_iso,
    in_reply_to: r.in_reply_to,
    body_excerpt: r.body.slice(0, 280),
  };
}

function escapeLikePattern(q: string): string {
  return `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`;
}

// ─── tool: list_emails ──────────────────────────────────────────────────────

export const listEmails = defineTool({
  name: 'list_emails',
  description:
    "List emails in a flexible window. The agent picks `since` / `until` to scope the query — leave both unset to mean 'all-time', set only `since` to mean 'recent', or set both to mean 'historical snapshot'. Default order is occurred_at ASC; set `order: \"desc\"` to flip. Returns headers + body excerpt; call get_email for the full body.",
  input: z
    .object({
      since: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('Lower bound (inclusive). ISO 8601 with offset. Omit to read from beginning.'),
      until: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('Upper bound (exclusive). ISO 8601 with offset. Omit to read up to now.'),
      from: z.string().max(200).optional().describe('Filter by `from_addr` (substring match).'),
      query: z
        .string()
        .max(200)
        .optional()
        .describe('Substring search across subject + body (case-insensitive).'),
      order: z.enum(['asc', 'desc']).default('asc'),
      limit: z.number().int().positive().max(500).default(100),
    })
    .strict(),
  handler: (args, ctx) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (args.since) {
      clauses.push('date_iso >= ?');
      params.push(args.since);
    }
    if (args.until) {
      clauses.push('date_iso < ?');
      params.push(args.until);
    }
    if (args.from) {
      clauses.push("from_addr LIKE ? ESCAPE '\\'");
      params.push(escapeLikePattern(args.from));
    }
    if (args.query) {
      clauses.push("(subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      params.push(escapeLikePattern(args.query), escapeLikePattern(args.query));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const orderSql = args.order === 'desc' ? 'DESC' : 'ASC';
    const sql = `SELECT message_id, thread_id, from_addr, to_addrs_json, cc_addrs_json,
                        subject, date_iso, in_reply_to, body
                 FROM emails ${where}
                 ORDER BY date_iso ${orderSql}
                 LIMIT ?`;
    params.push(args.limit);
    const rows = ctx.personaDb.prepare(sql).all(...params) as EmailRow[];
    return {
      window: { since: args.since ?? null, until: args.until ?? null },
      count: rows.length,
      emails: rows.map(rowToSummary),
    };
  },
});

// ─── tool: get_email ────────────────────────────────────────────────────────

export const getEmail = defineTool({
  name: 'get_email',
  description:
    'Fetch one email by message_id with full body and headers. Throws if the id is unknown.',
  input: z.object({ message_id: z.string().min(1) }).strict(),
  handler: (args, ctx) => {
    const row = ctx.personaDb
      .prepare(
        `SELECT message_id, thread_id, from_addr, to_addrs_json, cc_addrs_json,
                subject, date_iso, in_reply_to, body
           FROM emails
          WHERE message_id = ?`,
      )
      .get(args.message_id) as EmailRow | undefined;
    if (!row) throw new Error(`email not found: ${args.message_id}`);
    return {
      message_id: row.message_id,
      thread_id: row.thread_id,
      from: row.from_addr,
      to: parseAddrList(row.to_addrs_json),
      cc: parseAddrList(row.cc_addrs_json),
      subject: row.subject,
      occurred_at: row.date_iso,
      in_reply_to: row.in_reply_to,
      body: row.body,
    };
  },
});

// ─── tool: get_thread ───────────────────────────────────────────────────────

export const getThread = defineTool({
  name: 'get_thread',
  description:
    "Fetch every message in a thread, oldest-first. Use this when you want the full back-and-forth context — citations point at thread ids when the conversation is multi-message.",
  input: z.object({ thread_id: z.string().min(1) }).strict(),
  handler: (args, ctx) => {
    const rows = ctx.personaDb
      .prepare(
        `SELECT message_id, thread_id, from_addr, to_addrs_json, cc_addrs_json,
                subject, date_iso, in_reply_to, body
           FROM emails
          WHERE thread_id = ?
          ORDER BY date_iso ASC`,
      )
      .all(args.thread_id) as EmailRow[];
    if (rows.length === 0) throw new Error(`thread not found: ${args.thread_id}`);
    return {
      thread_id: args.thread_id,
      count: rows.length,
      messages: rows.map((r) => ({
        message_id: r.message_id,
        from: r.from_addr,
        to: parseAddrList(r.to_addrs_json),
        cc: parseAddrList(r.cc_addrs_json),
        subject: r.subject,
        occurred_at: r.date_iso,
        in_reply_to: r.in_reply_to,
        body: r.body,
      })),
    };
  },
});

// ─── tool: search_emails ────────────────────────────────────────────────────

export const searchEmails = defineTool({
  name: 'search_emails',
  description:
    'Substring search across subject + body across the full inbox history. Case-insensitive. Use when you need to find a specific matter without knowing the date window.',
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
        `SELECT message_id, thread_id, from_addr, to_addrs_json, cc_addrs_json,
                subject, date_iso, in_reply_to, body
           FROM emails
          WHERE subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
          ORDER BY date_iso DESC
          LIMIT ?`,
      )
      .all(pattern, pattern, args.max) as EmailRow[];
    return { query: args.query, count: rows.length, emails: rows.map(rowToSummary) };
  },
});

// ─── exports ────────────────────────────────────────────────────────────────

export const personaEmailTools = {
  [listEmails.name]: listEmails,
  [getEmail.name]: getEmail,
  [getThread.name]: getThread,
  [searchEmails.name]: searchEmails,
} as unknown as Record<string, AnyPersonaEmailTool>;

export const personaEmailToolNames: readonly string[] = Object.keys(personaEmailTools);
