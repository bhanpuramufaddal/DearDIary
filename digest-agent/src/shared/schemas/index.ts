/**
 * Zod schemas mirroring the shared types.
 *
 * Used at trust boundaries:
 *  - IPC `ipcMain.handle` arguments coming from the renderer.
 *  - MCP tool input validation in substrate + surface servers.
 *  - Webhook adapter outputs (each adapter validates its normalized event).
 *
 * The types in `../types/` are the canonical TS shapes; these schemas are the
 * runtime check. Keep them in sync — if you add a field to a type, add it here too.
 */

import { z } from 'zod';

// ─── Primitives ──────────────────────────────────────────────────────────────

export const idSchema = z.string().min(1).max(256);
export const sourceIdSchema = z
  .string()
  .min(3)
  .max(512)
  .regex(/^[a-z][\w-]*:.+$/i, 'expected <source-tag>:<stable-id>');
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const precisionSchema = z.number().min(0.05).max(0.95);
export const layerNameSchema = z.enum(['slow', 'mid', 'fast']);
export const evidenceKindSchema = z.enum(['support', 'contradict']);

// ─── Case base ───────────────────────────────────────────────────────────────

export const caseBaseEntrySchema = z.object({
  id: idSchema,
  node_id: idSchema,
  layer: layerNameSchema.nullable(),
  source_id: sourceIdSchema,
  date: isoDateSchema,
  note: z.string().max(2000).optional(),
  position: z.number().int().nonnegative(),
});

// ─── Relationships ───────────────────────────────────────────────────────────

export const relationshipLayerSchema = z.object({
  claim: z.string().max(2000),
  precision: precisionSchema,
});

export const relationshipSchema = z.object({
  id: idSchema,
  subject_id: idSchema,
  target_id: idSchema,
  slow: relationshipLayerSchema,
  mid: relationshipLayerSchema,
  fast: relationshipLayerSchema,
});

// ─── Predictions ─────────────────────────────────────────────────────────────

export const predictionKindSchema = z.enum(['event', 'fact', 'pattern']);

export const predictionSchema = z
  .object({
    id: idSchema,
    anchor_id: idSchema,
    kind: predictionKindSchema,
    claim: z.string().min(1).max(2000),
    expected_by: isoDateTimeSchema.optional(),
    based_on: z.array(layerNameSchema).min(1),
    precision: precisionSchema,
    created_at: isoDateTimeSchema,
    source_dispatchable: z.string().optional(),
  })
  .refine((p) => (p.kind === 'event' ? !!p.expected_by : !p.expected_by), {
    message: 'expected_by is required for kind=event and forbidden otherwise',
    path: ['expected_by'],
  });

// ─── Nodes (anchor / entity) ─────────────────────────────────────────────────

export const layerObjectSchema = z.object({
  content: z.string(),
  precision: precisionSchema,
  case_base: z.array(caseBaseEntrySchema),
});

export const anchorSchema = z.object({
  id: idSchema,
  kind: z.string().min(1).max(64),
  display_name: z.string().max(256).optional(),
  created_at: isoDateTimeSchema,
  activation: z.number().nonnegative(),
  last_bumped: isoDateTimeSchema,
  identity_handles: z.array(z.string()).default([]),
  slow: layerObjectSchema,
  mid: layerObjectSchema,
  fast: layerObjectSchema,
  notes: z.string().optional(),
  relationships: z.array(relationshipSchema).default([]),
  predictions: z.array(predictionSchema).default([]),
});

export const entitySchema = z.object({
  id: idSchema,
  kind: z.string().min(1).max(64),
  first_seen: isoDateTimeSchema,
  last_seen: isoDateTimeSchema,
  mention_count: z.number().int().nonnegative(),
  identity_handles: z.array(z.string()).default([]),
  notes: z.string().optional(),
  case_base: z.array(caseBaseEntrySchema).default([]),
  relationships: z.array(relationshipSchema).default([]),
});

// ─── Reminders ───────────────────────────────────────────────────────────────

export const reminderSchema = z.object({
  id: idSchema,
  fires_at: isoDateTimeSchema,
  context: z.string().min(1).max(4000),
  related_anchors: z.array(idSchema).default([]),
  set_by: z.enum(['mind_agent', 'diary_agent']),
  set_at: isoDateTimeSchema,
  fired_at: isoDateTimeSchema.nullable(),
});

// ─── Diary ──────────────────────────────────────────────────────────────────

/**
 * Section label — free-form string. Taxonomy lives in the prompt/playbook, not
 * in the schema (see src/shared/types/diary.ts `RECOMMENDED_SECTIONS` for the
 * default vocabulary the agent uses).
 */
export const diarySectionSchema = z.string().min(1).max(64);
export const componentTypeSchema = z.enum([
  'email-draft',
  'calendar-block',
  'choose-one',
  'free-text-reply',
  'diary-prose',
  'big-number',
  'stat-block',
  'chart',
  'report',
]);
export const componentStatusSchema = z.enum(['open', 'acted', 'closed', 'dismissed']);
export const templateIdSchema = z.enum([
  'email-draft.inline',
  'calendar-block.decision',
  'choose-one.cards',
  'free-text-reply.compose',
  'diary-prose.note',
  'diary-prose.flash',
  'big-number.metric',
  'stat-block.summary',
  'chart.timeseries',
  'chart.bar',
  'report.brief',
]);

export const componentActionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  kind: z.string().min(1).max(64),
});

export const diaryCommentSchema = z.object({
  id: idSchema,
  component_id: idSchema,
  text: z.string().min(1).max(8000),
  created_at: isoDateTimeSchema,
});

export const diaryNoteSchema = z.object({
  id: idSchema,
  diary_date: isoDateSchema,
  text: z.string().min(1).max(8000),
  created_at: isoDateTimeSchema,
});

export const diaryThinkingEntrySchema = z.object({
  id: idSchema,
  diary_date: isoDateSchema,
  tick_at: isoDateTimeSchema,
  entries: z.array(z.string().max(4000)),
});

export const diaryComponentSchema = z.object({
  id: idSchema,
  diary_date: isoDateSchema,
  type: componentTypeSchema,
  section: diarySectionSchema,
  template_id: templateIdSchema,
  anchor_refs: z.array(idSchema).default([]),
  supporting_artifact_ids: z.array(z.string().min(1).max(512)).default([]),
  headline: z.string().max(256).optional(),
  rationale: z.string().max(4000).optional(),
  content: z.record(z.unknown()).default({}),
  actions: z.array(componentActionSchema).default([]),
  status: componentStatusSchema,
  comments: z.array(diaryCommentSchema).default([]),
  efference_prediction_id: idSchema.optional(),
});

export const diarySchema = z.object({
  date: isoDateSchema,
  /**
   * Section labels are agent-chosen; the schema accepts any string key.
   * Renderer iterates `Object.entries(sections)`.
   */
  sections: z.record(z.array(diaryComponentSchema)),
  notes: z.array(diaryNoteSchema),
  thinking_layer: z.array(diaryThinkingEntrySchema),
});

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const taskFiredSchema = z.object({
  task_id: idSchema,
  component_id: idSchema,
  diary_date: isoDateSchema,
  action: z.object({
    id: z.string(),
    kind: z.string(),
  }),
  principal_input: z.unknown(),
  context_pointers: z.object({
    anchor_ids: z.array(idSchema),
    source_id: sourceIdSchema.optional(),
  }),
});

export const taskOutcomeSchema = z.object({
  task_id: idSchema,
  component_id: idSchema,
  outcome: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

// ─── Webhook (normalized) ───────────────────────────────────────────────────

export const webhookEventPayloadSchema = z.object({
  id: sourceIdSchema,
  source: z.string().min(1).max(64),
  observed_at: isoDateTimeSchema,
  occurred_at: isoDateTimeSchema,
  identity_handles: z.array(z.string()),
  payload: z.record(z.unknown()),
});

// ─── Config ──────────────────────────────────────────────────────────────────

export const tunnelKindSchema = z.enum(['ngrok', 'external']);

export const appConfigSchema = z.object({
  timezone: z.string().min(1),
  digest_dir: z.string().min(1),
  event_sources: z.array(
    z.object({ id: z.string(), kind: z.string() }).passthrough(),
  ),
  mcp_servers: z.array(
    z.object({
      id: z.string(),
      command: z.string(),
      env: z.record(z.string()).optional(),
    }),
  ),
  agent_mcp_access: z.object({
    mind: z.array(z.string()),
    diary: z.array(z.string()),
    cold_start: z.array(z.string()),
  }),
  webhook: z.object({
    public_url: z.string().url(),
    bind_host: z.string(),
    bind_port: z.number().int().positive(),
    tunnel: z
      .object({
        kind: tunnelKindSchema,
        authtoken_env: z.string().optional(),
        domain: z.string().optional(),
      })
      .optional(),
  }),
  schedule: z.object({
    diary_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)),
  }),
  claude_code: z.object({
    executable: z.string().default('claude'),
    extra_flags: z.array(z.string()).default([]),
  }),
  model: z.object({
    mind_agent: z.string(),
    diary_agent: z.string(),
    cold_start_agent: z.string(),
    execution_agent: z.string(),
  }),
  api_key_env: z.string().default('ANTHROPIC_API_KEY'),
  mcp: z.object({
    cache_ttl_minutes: z.number().nonnegative().default(5),
  }),
  log_dir: z.string(),
});
