import type { ReminderId, SourceId } from './ids.js';
import type { TaskFiredEvent, TaskOutcomeEvent } from './tasks.js';

/**
 * Normalized event payload — every webhook adapter, every internal trigger
 * lands as this shape on the bus. See design/04-adapters.md.
 */
export interface WebhookEventPayload {
  id: SourceId;
  source: string; // free-form source tag, e.g. `inbox-gmail`, `calendar-google`, `persona-emulator`
  observed_at: string;
  occurred_at: string;
  identity_handles: string[];
  payload: Record<string, unknown>;
}

export interface ReminderEventPayload {
  reminder_id: ReminderId;
  context: string;
  related_anchors: string[];
  fires_at: string;
}

export interface ScheduleDiaryTickPayload {
  trigger_at: string;
}

export interface ProfileChangedPayload {
  mtime: string;
  path: string;
}

export interface InvocationOutcomePayload {
  invocation_id: string;
  role: 'mind' | 'diary' | 'cold_start';
  exit_code: number;
  duration_ms: number;
  outcome?: Record<string, unknown>;
  error?: string;
  /**
   * The event that caused this invocation. Used by the persona-clock driver
   * (test mode) to anchor the simulated clock on the processing point rather
   * than the arrival point — so the clock can only advance once mind has
   * actually digested the triggering event.
   *
   * Currently populated by the mind dispatcher; diary / cold_start dispatchers
   * may set it later. `kind` is typed as string here to avoid a forward-reference
   * to `BusKind` which is declared further down this file.
   */
  triggering?: {
    kind: string;
    source_id?: string;
    occurred_at?: string;
  };
}

export interface TunnelLifecyclePayload {
  public_url?: string;
  reason?: string;
}

export interface DiaryCommentPayload {
  component_id: string;
  text: string;
  created_at: string;
}

export interface DiaryNotePayload {
  diary_date: string;
  text: string;
  created_at: string;
}

/**
 * Discriminated union of every event the bus carries.
 * `kind` is the discriminator. `PayloadOf<K>` recovers the payload type.
 */
export type BusEvent =
  | { kind: 'webhook.persona'; payload: WebhookEventPayload }
  | { kind: 'webhook.gmail'; payload: WebhookEventPayload }
  | { kind: 'webhook.gcal'; payload: WebhookEventPayload }
  | { kind: 'reminder.fired'; payload: ReminderEventPayload }
  | { kind: 'schedule.diary_tick'; payload: ScheduleDiaryTickPayload }
  | { kind: 'profile.changed'; payload: ProfileChangedPayload }
  | { kind: 'diary.comment.added'; payload: DiaryCommentPayload }
  | { kind: 'diary.note.added'; payload: DiaryNotePayload }
  | { kind: 'task.fired'; payload: TaskFiredEvent }
  | { kind: 'task.completed'; payload: TaskOutcomeEvent }
  | { kind: 'task.failed'; payload: TaskOutcomeEvent }
  | { kind: 'mind.invocation.done'; payload: InvocationOutcomePayload }
  | { kind: 'diary.invocation.done'; payload: InvocationOutcomePayload }
  | { kind: 'coldstart.invocation.done'; payload: InvocationOutcomePayload }
  | { kind: 'tunnel.up'; payload: TunnelLifecyclePayload }
  | { kind: 'tunnel.down'; payload: TunnelLifecyclePayload };

export type BusKind = BusEvent['kind'];
export type PayloadOf<K extends BusKind> = Extract<BusEvent, { kind: K }>['payload'];
