/**
 * Reminder tools — the agent's self-scheduled callbacks.
 *
 * At fires_at, the daemon's reminder scheduler emits `reminder.fired` and
 * the mind agent receives it as a fresh event. Reminders link to anchors
 * via reminder_anchor_refs (so a deleted anchor doesn't strand a reminder);
 * both rows insert atomically here.
 */

import { z } from 'zod';
import { defineTool } from '../tool.js';
import { makeAnchorsRepo } from '../../../db/anchors.js';
import { makeRemindersRepo } from '../../../db/reminders.js';
import type { AnchorId, ReminderId } from '@shared/types/ids.js';
import { genId } from './_ids.js';

const idSchema = z.string().min(1).max(128).regex(/^_?[a-z][\w-]*$/i, 'id must match /^_?[a-z][\\w-]*$/i');
const remIdSchema = z.string().min(1).max(128).regex(/^rem_[\w-]+$/, 'reminder id must match /^rem_[\\w-]+$/');

// ─── set_reminder ──────────────────────────────────────────────────────────

export const setReminder = defineTool({
  name: 'set_reminder',
  description:
    "Schedule a self-reminder. At `fires_at` (ISO 8601 with offset), the daemon emits a fresh event the mind agent receives. `anchor_ids` link this reminder to its anchors (empty for global reminders). Server-generated id (`rem_…`). Atomic: inserts reminders + reminder_anchor_refs.",
  input: z
    .object({
      fires_at: z.string().datetime({ offset: true }),
      context: z.string().min(1).max(4000),
      anchor_ids: z.array(idSchema).default([]),
      set_by: z.enum(['mind_agent', 'diary_agent']).default('mind_agent'),
    })
    .strict(),
  handler: (args, ctx) => {
    const anchors = makeAnchorsRepo(ctx.db);
    for (const anchorId of args.anchor_ids) {
      if (!anchors.readAnchor(anchorId as AnchorId)) {
        throw new Error(`anchor not found: ${anchorId}`);
      }
    }

    const reminders = makeRemindersRepo(ctx.db);
    const id = genId('rem');
    reminders.createReminder({
      id,
      fires_at: args.fires_at,
      context: args.context,
      set_by: args.set_by,
      set_at: ctx.now(),
      related_anchors: args.anchor_ids as AnchorId[],
    });
    return { id };
  },
});

// ─── cancel_reminder ───────────────────────────────────────────────────────

export const cancelReminder = defineTool({
  name: 'cancel_reminder',
  description:
    "Cancel a pending reminder before it fires. Returns { ok: true } on success.",
  input: z.object({ id: remIdSchema }).strict(),
  handler: (args, ctx) => {
    const reminders = makeRemindersRepo(ctx.db);
    const exists = ctx.db
      .prepare('SELECT 1 FROM reminders WHERE id = ?')
      .get(args.id);
    if (!exists) throw new Error(`reminder not found: ${args.id}`);
    reminders.deleteReminder(args.id as ReminderId);
    return { ok: true as const, id: args.id };
  },
});

export const reminderTools = {
  [setReminder.name]: setReminder,
  [cancelReminder.name]: cancelReminder,
};
