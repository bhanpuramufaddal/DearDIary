import type {
  AnchorId,
  DiaryCommentId,
  DiaryComponentId,
  DiaryNoteId,
  DiaryThinkingEntryId,
  PredictionId,
} from './ids.js';

/**
 * A diary section label. Free-form string (not a strict enum) because the
 * agent picks the taxonomy per tick from prompt/playbook guidance — topical
 * (`urgent_todo`, `decisions_approvals`, `calendar_personal`, …),
 * time-horizon (legacy: `right_now`, `on_the_desk`, …), or whatever a
 * customize.md instructs. The renderer groups by whatever label the agent
 * writes; the playbook teaches which conventions to honor.
 */
export type DiarySection = string;

/**
 * The conventional default section vocabulary the digest agent draws on,
 * matching the trial brief's rubric. Treated as guidance in the prompt,
 * not as schema enforcement — callers can use other labels when a
 * customize.md says so.
 */
export const RECOMMENDED_SECTIONS = [
  'if_one_thing',
  'urgent_todo',
  'decisions_approvals',
  'team_pulse',
  'calendar_personal',
  'ai_industry_news',
] as const;

export type ComponentType =
  | 'email-draft'
  | 'calendar-block'
  | 'choose-one'
  | 'free-text-reply'
  | 'diary-prose'
  | 'big-number'
  | 'stat-block'
  | 'chart'
  | 'report';

export type ComponentStatus = 'open' | 'acted' | 'closed' | 'dismissed';

/**
 * Template id selects which HITL template renders the component.
 * Phase 10 ships six initial templates; the diary agent picks per component.
 * See design/02-diary-model.md#hitl-template-library.
 */
export type TemplateId =
  | 'email-draft.inline'
  | 'calendar-block.decision'
  | 'choose-one.cards'
  | 'free-text-reply.compose'
  | 'diary-prose.note'
  | 'diary-prose.flash'
  | 'big-number.metric'
  | 'stat-block.summary'
  | 'chart.timeseries'
  | 'chart.bar'
  | 'report.brief';

export interface ComponentAction {
  id: string;
  label: string;
  kind: string; // e.g. send_email, decline_event, pick_option — the execution agent reads it
}

export interface DiaryComponent {
  id: DiaryComponentId;
  diary_date: string; // YYYY-MM-DD
  type: ComponentType;
  section: DiarySection;
  template_id: TemplateId;
  anchor_refs: AnchorId[];
  /**
   * Source ids the component cites (e.g. `gmail:<msg-id>`, `gcal:<event-uid>`,
   * `notion:<page-id>`). Populated by the diary agent from anchor case_bases
   * and from the events it read during composition. The renderer formats each
   * id as an inline citation like `[email: Marcus, May 19 16:42]`.
   */
  supporting_artifact_ids?: string[];
  headline?: string;
  rationale?: string;
  content: Record<string, unknown>; // type-specific payload; validated per template
  actions: ComponentAction[];
  status: ComponentStatus;
  comments: DiaryComment[];
  efference_prediction_id?: PredictionId;
}

export interface DiaryComment {
  id: DiaryCommentId;
  component_id: DiaryComponentId;
  text: string;
  created_at: string;
}

export interface DiaryNote {
  id: DiaryNoteId;
  diary_date: string;
  text: string;
  created_at: string;
}

export interface DiaryThinkingEntry {
  id: DiaryThinkingEntryId;
  diary_date: string;
  tick_at: string;
  entries: string[];
}

/**
 * Assembled diary document — the on-the-wire shape returned by `digest_get`
 * and consumed by the renderer's diary view.
 */
export interface Diary {
  date: string;
  /**
   * Keyed by whatever section label the agent wrote. Iterate via
   * `Object.entries(diary.sections)` — there is no fixed key list.
   */
  sections: Record<string, DiaryComponent[]>;
  notes: DiaryNote[];
  thinking_layer: DiaryThinkingEntry[];
}
