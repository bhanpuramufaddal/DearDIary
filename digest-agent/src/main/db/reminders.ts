import type { AnchorId, ReminderId } from '@shared/types/ids.js';
import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export interface ReminderRow {
  id: ReminderId;
  fires_at: string;
  context: string;
  set_by: 'mind_agent' | 'diary_agent';
  set_at: string;
  fired_at: string | null;
}

export interface CreateReminderInput {
  id: string;
  fires_at: string;
  context: string;
  set_by: 'mind_agent' | 'diary_agent';
  set_at: string;
  related_anchors: AnchorId[];
}

export function makeRemindersRepo(db: Db) {
  const stmt = makeStatementCache(db);

  return {
    createReminder(input: CreateReminderInput): void {
      const insertReminder = stmt(
        `INSERT INTO reminders (id, fires_at, context, set_by, set_at, fired_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      );
      const insertRef = stmt(
        'INSERT INTO reminder_anchor_refs (reminder_id, anchor_id) VALUES (?, ?)',
      );

      const tx = db.transaction(() => {
        insertReminder.run(input.id, input.fires_at, input.context, input.set_by, input.set_at);
        for (const anchorId of input.related_anchors) {
          insertRef.run(input.id, anchorId);
        }
      });
      tx();
    },

    pendingReminders(): ReminderRow[] {
      return stmt(
        'SELECT * FROM reminders WHERE fired_at IS NULL ORDER BY fires_at ASC',
      ).all() as ReminderRow[];
    },

    relatedAnchors(reminderId: ReminderId): AnchorId[] {
      return (
        stmt('SELECT anchor_id FROM reminder_anchor_refs WHERE reminder_id = ?').all(
          reminderId,
        ) as { anchor_id: AnchorId }[]
      ).map((r) => r.anchor_id);
    },

    markFired(id: ReminderId, firedAt: string): void {
      stmt('UPDATE reminders SET fired_at = ? WHERE id = ?').run(firedAt, id);
    },

    deleteReminder(id: ReminderId): void {
      stmt('DELETE FROM reminders WHERE id = ?').run(id);
    },
  };
}
