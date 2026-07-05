import type { AnchorId, ReminderId } from './ids.js';

export type ReminderSetter = 'mind_agent' | 'diary_agent';

export interface Reminder {
  id: ReminderId;
  fires_at: string; // ISO 8601 datetime
  context: string;
  related_anchors: AnchorId[];
  set_by: ReminderSetter;
  set_at: string;
  fired_at: string | null;
}
