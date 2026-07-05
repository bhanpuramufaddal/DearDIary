/**
 * persona-notes MCP tools.
 *
 * Test-mode stand-in for a real Notes / Notion MCP. Backs onto persona.db's
 * `notes` table. Serves BOTH live queries AND historical snapshots — each
 * note carries `created_iso` and `updated_iso`, so the agent can ask for
 * "notes touched in the last 24 hours" or "notes that existed by May 1".
 *
 * persona.db does not track per-edit version history; `get_note_at` returns
 * the latest content but flags the as-of timestamp so the agent can tell
 * whether the snapshot is fresh or stale relative to its query.
 */

import { z, type ZodTypeAny } from 'zod';
import Database from 'better-sqlite3';

export type PersonaDb = Database.Database;

export interface PersonaNotesToolContext {
  personaDb: PersonaDb;
  now: () => string;
}

export interface PersonaNotesTool<I extends ZodTypeAny = ZodTypeAny, O = unknown> {
  name: string;
  description: string;
  input: I;
  handler: (args: z.infer<I>, ctx: PersonaNotesToolContext) => O | Promise<O>;
}

export function defineTool<I extends ZodTypeAny, O>(spec: {
  name: string;
  description: string;
  input: I;
  handler: (args: z.infer<I>, ctx: PersonaNotesToolContext) => O | Promise<O>;
}): PersonaNotesTool<I, O> {
  return spec;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPersonaNotesTool = PersonaNotesTool<z.ZodType<any, any, any>, unknown>;

// ─── helpers ────────────────────────────────────────────────────────────────

interface NoteRow {
  note_id: string;
  filename: string;
  title: string | null;
  body: string;
  created_iso: string;
  updated_iso: string | null;
}

function rowToSummary(r: NoteRow): {
  note_id: string;
  filename: string;
  title: string | null;
  occurred_at: string;
  updated_at: string | null;
  body_excerpt: string;
} {
  return {
    note_id: r.note_id,
    filename: r.filename,
    title: r.title,
    occurred_at: r.created_iso,
    updated_at: r.updated_iso,
    body_excerpt: r.body.slice(0, 280),
  };
}

function escapeLikePattern(q: string): string {
  return `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`;
}

// ─── tool: list_notes ───────────────────────────────────────────────────────

export const listNotes = defineTool({
  name: 'list_notes',
  description:
    "List notes whose `last_touched_at` (updated_iso when present, otherwise created_iso) falls in the window. Set both `since` and `until` for a historical snapshot. Set `at` instead for 'notes that existed by this date'. Default order is last-touched ASC.",
  input: z
    .object({
      since: z.string().datetime({ offset: true }).optional(),
      until: z.string().datetime({ offset: true }).optional(),
      at: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe(
          "Point-in-time snapshot: returns notes that existed AND had been touched by this timestamp.",
        ),
      query: z
        .string()
        .max(200)
        .optional()
        .describe('Substring match against title + body.'),
      order: z.enum(['asc', 'desc']).default('asc'),
      limit: z.number().int().positive().max(500).default(100),
    })
    .strict(),
  handler: (args, ctx) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    // last_touched = COALESCE(updated_iso, created_iso)
    const lastTouched = 'COALESCE(updated_iso, created_iso)';
    if (args.at) {
      clauses.push(`${lastTouched} <= ?`);
      params.push(args.at);
    } else {
      if (args.since) {
        clauses.push(`${lastTouched} >= ?`);
        params.push(args.since);
      }
      if (args.until) {
        clauses.push(`${lastTouched} < ?`);
        params.push(args.until);
      }
    }
    if (args.query) {
      clauses.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      params.push(escapeLikePattern(args.query), escapeLikePattern(args.query));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const orderSql = args.order === 'desc' ? 'DESC' : 'ASC';
    const sql = `SELECT note_id, filename, title, body, created_iso, updated_iso
                 FROM notes ${where}
                 ORDER BY ${lastTouched} ${orderSql}
                 LIMIT ?`;
    params.push(args.limit);
    const rows = ctx.personaDb.prepare(sql).all(...params) as NoteRow[];
    return {
      window: { since: args.since ?? null, until: args.until ?? null, at: args.at ?? null },
      count: rows.length,
      notes: rows.map(rowToSummary),
    };
  },
});

// ─── tool: get_note ─────────────────────────────────────────────────────────

export const getNote = defineTool({
  name: 'get_note',
  description: 'Fetch one note by note_id with full body. Throws if the id is unknown.',
  input: z.object({ note_id: z.string().min(1) }).strict(),
  handler: (args, ctx) => {
    const row = ctx.personaDb
      .prepare(
        `SELECT note_id, filename, title, body, created_iso, updated_iso
           FROM notes
          WHERE note_id = ?`,
      )
      .get(args.note_id) as NoteRow | undefined;
    if (!row) throw new Error(`note not found: ${args.note_id}`);
    return {
      note_id: row.note_id,
      filename: row.filename,
      title: row.title,
      occurred_at: row.created_iso,
      updated_at: row.updated_iso,
      body: row.body,
    };
  },
});

// ─── tool: get_note_at ──────────────────────────────────────────────────────

export const getNoteAt = defineTool({
  name: 'get_note_at',
  description:
    "Fetch a note's content as it stood at a given point in time. Returns the latest content along with `as_of` (the note's most-recent updated_iso ≤ `at`) so the caller can tell whether the snapshot is fresh or stale. Returns null if the note didn't exist by `at`. persona.db does not retain per-edit history; this tool is the cleanest approximation.",
  input: z
    .object({
      note_id: z.string().min(1),
      at: z.string().datetime({ offset: true }),
    })
    .strict(),
  handler: (args, ctx) => {
    const row = ctx.personaDb
      .prepare(
        `SELECT note_id, filename, title, body, created_iso, updated_iso
           FROM notes
          WHERE note_id = ? AND created_iso <= ?`,
      )
      .get(args.note_id, args.at) as NoteRow | undefined;
    if (!row) return null;
    const lastTouched = row.updated_iso ?? row.created_iso;
    return {
      note_id: row.note_id,
      filename: row.filename,
      title: row.title,
      requested_at: args.at,
      as_of: lastTouched,
      stale: lastTouched > args.at,
      occurred_at: row.created_iso,
      updated_at: row.updated_iso,
      body: row.body,
    };
  },
});

// ─── tool: search_notes ─────────────────────────────────────────────────────

export const searchNotes = defineTool({
  name: 'search_notes',
  description: 'Substring search across note title + body. Case-insensitive.',
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
        `SELECT note_id, filename, title, body, created_iso, updated_iso
           FROM notes
          WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
          ORDER BY COALESCE(updated_iso, created_iso) DESC
          LIMIT ?`,
      )
      .all(pattern, pattern, args.max) as NoteRow[];
    return { query: args.query, count: rows.length, notes: rows.map(rowToSummary) };
  },
});

// ─── exports ────────────────────────────────────────────────────────────────

export const personaNotesTools = {
  [listNotes.name]: listNotes,
  [getNote.name]: getNote,
  [getNoteAt.name]: getNoteAt,
  [searchNotes.name]: searchNotes,
} as unknown as Record<string, AnyPersonaNotesTool>;

export const personaNotesToolNames: readonly string[] = Object.keys(personaNotesTools);
