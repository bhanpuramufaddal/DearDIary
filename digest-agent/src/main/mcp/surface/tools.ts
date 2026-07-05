/**
 * Surface MCP tools — the principal's `/digest` integration in Claude Code.
 *
 * Five tools per design/00-architecture-overview.md § "MCP surfaces":
 *
 *  - digest_get({date?})              — assemble + return diary JSON
 *  - digest_run({force?})             — fire a diary tick, block, return diary
 *  - diary_act({component_id, …})     — emit task.fired (does NOT execute)
 *  - diary_add_comment({…})           — add comment row + emit diary.comment.added
 *  - diary_add_note({date, text})     — add note row + emit diary.note.added
 *
 * The bus-event emits flow through the pending_bus_events relay because this
 * server runs as a subprocess of Claude Code, not main.
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import { defineTool, type ToolContext } from '../substrate/tool.js';
import { makeDiaryRepo } from '../../db/diary.js';
import { makeEventsRepo } from '../../db/events.js';
import { makePendingEventsRepo } from '../../db/pendingEvents.js';
import type { DiaryComponentId } from '@shared/types/ids.js';

export interface SurfaceContext extends ToolContext {
  /**
   * digest_run polls the events audit log for diary.invocation.done.
   * Tests can shorten this for the digest_run smoke test.
   */
  diaryRunPollMs?: number;
  diaryRunTimeoutMs?: number;
}

const DEFAULT_RUN_POLL_MS = 500;
const DEFAULT_RUN_TIMEOUT_MS = 20 * 60 * 1000;

function todayISO(now: string): string {
  return now.slice(0, 10);
}

export const digestGet = defineTool({
  name: 'digest_get',
  description:
    "Return the assembled diary JSON for today (or a specified YYYY-MM-DD date). Pure read; no events emitted.",
  input: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
  handler: (args, ctx) => {
    const diary = makeDiaryRepo(ctx.db);
    const date = args.date ?? todayISO(ctx.now());
    return diary.assembleDiary(date);
  },
});

export const digestRun = defineTool({
  name: 'digest_run',
  description:
    "Fire a fresh diary tick now and block until composition completes. Returns the assembled diary JSON for today.",
  input: z.object({}).strict(),
  handler: async (_args, ctx) => {
    const sctx = ctx as SurfaceContext;
    const events = makeEventsRepo(ctx.db);
    const pending = makePendingEventsRepo(ctx.db);
    const diary = makeDiaryRepo(ctx.db);

    // Record the cursor BEFORE submitting the trigger so we can detect the
    // matching diary.invocation.done that follows our request.
    const startCursor = events.latestEventId();

    // Enqueue the trigger event; main's relay will fire diaryDispatcher.fireNow().
    pending.enqueue(
      'schedule.diary_tick',
      { trigger_at: new Date().toISOString() },
      null,
      ctx.now(),
    );

    // Poll the events table for diary.invocation.done past our start cursor.
    const pollMs = sctx.diaryRunPollMs ?? DEFAULT_RUN_POLL_MS;
    const timeoutMs = sctx.diaryRunTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const rows = events.eventsSince(startCursor, ['diary.invocation.done']);
      if (rows.length > 0) {
        const today = todayISO(ctx.now());
        return diary.assembleDiary(today);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`digest_run timed out after ${timeoutMs}ms waiting for diary composition`);
  },
});

export const diaryAct = defineTool({
  name: 'diary_act',
  description:
    "Record the principal's action on a HITL component and emit task.fired. Does NOT execute against the world — a separate Claude Code execution instance picks up the task.fired event and runs it.",
  input: z
    .object({
      component_id: z.string().min(1),
      action: z.object({
        id: z.string().min(1),
        kind: z.string().min(1),
      }),
      principal_input: z.unknown().optional(),
    })
    .strict(),
  handler: (args, ctx) => {
    const pending = makePendingEventsRepo(ctx.db);
    const taskId = nanoid(12);

    // Look up the component to populate context_pointers.
    const compRow = ctx.db
      .prepare('SELECT diary_date FROM diary_components WHERE id = ?')
      .get(args.component_id) as { diary_date: string } | undefined;
    if (!compRow) {
      throw new Error(`diary component not found: ${args.component_id}`);
    }
    const anchorRefs = (
      ctx.db
        .prepare(
          'SELECT anchor_id FROM diary_component_anchor_refs WHERE component_id = ? ORDER BY position ASC',
        )
        .all(args.component_id) as { anchor_id: string }[]
    ).map((r) => r.anchor_id);

    pending.enqueue(
      'task.fired',
      {
        task_id: taskId,
        component_id: args.component_id,
        diary_date: compRow.diary_date,
        action: args.action,
        principal_input: args.principal_input ?? null,
        context_pointers: { anchor_ids: anchorRefs },
      },
      null,
      ctx.now(),
    );
    return { task_id: taskId };
  },
});

export const diaryAddComment = defineTool({
  name: 'diary_add_comment',
  description:
    "Add a principal comment on a diary component. Writes the row to diary_comments and emits diary.comment.added so the mind agent processes it.",
  input: z
    .object({
      component_id: z.string().min(1),
      text: z.string().min(1).max(8000),
    })
    .strict(),
  handler: (args, ctx) => {
    const diary = makeDiaryRepo(ctx.db);
    const pending = makePendingEventsRepo(ctx.db);
    const id = `cmt_${nanoid(10)}`;
    const createdAt = ctx.now();

    const exists = ctx.db
      .prepare('SELECT 1 FROM diary_components WHERE id = ?')
      .get(args.component_id);
    if (!exists) {
      throw new Error(`diary component not found: ${args.component_id}`);
    }

    const tx = ctx.db.transaction(() => {
      diary.addComment(args.component_id as DiaryComponentId, id, args.text, createdAt);
      pending.enqueue(
        'diary.comment.added',
        { component_id: args.component_id, text: args.text, created_at: createdAt },
        null,
        createdAt,
      );
    });
    tx();
    return { id };
  },
});

export const diaryAddNote = defineTool({
  name: 'diary_add_note',
  description:
    "Add a principal note to a diary day's bottom-of-page notes. Writes to diary_notes and emits diary.note.added.",
  input: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      text: z.string().min(1).max(8000),
    })
    .strict(),
  handler: (args, ctx) => {
    const diary = makeDiaryRepo(ctx.db);
    const pending = makePendingEventsRepo(ctx.db);
    const date = args.date ?? todayISO(ctx.now());
    const id = `note_${nanoid(10)}`;
    const createdAt = ctx.now();

    const tx = ctx.db.transaction(() => {
      diary.addNote(date, id, args.text, createdAt);
      pending.enqueue(
        'diary.note.added',
        { diary_date: date, text: args.text, created_at: createdAt },
        null,
        createdAt,
      );
    });
    tx();
    return { id };
  },
});

export const surfaceTools = {
  [digestGet.name]: digestGet,
  [digestRun.name]: digestRun,
  [diaryAct.name]: diaryAct,
  [diaryAddComment.name]: diaryAddComment,
  [diaryAddNote.name]: diaryAddNote,
};
