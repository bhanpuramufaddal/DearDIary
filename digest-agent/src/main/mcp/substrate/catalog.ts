/**
 * Substrate-MCP catalog — per-role tool allowlists.
 *
 * Source of truth: design/03a-agent-shape.md (per-role MCP tool catalogs).
 * The substrate MCP server reads `--role=<mind|diary|cold-start>` from argv
 * and registers exactly the tools listed here. No other tools are reachable
 * by the connected Claude Code subprocess — that's the architectural
 * enforcement of role separation.
 */

import type { AnyTool } from './tool.js';
import { readerTools } from './tools/readers.js';
import { sqlTools } from './tools/sql.js';
import { precisionTools } from './tools/precision.js';
import { anchorTools } from './tools/anchors.js';
import { entityTools } from './tools/entities.js';
import { relationshipTools } from './tools/relationships.js';
import { predictionTools } from './tools/predictions.js';
import { reminderTools } from './tools/reminders.js';
import { playTools } from './tools/plays.js';
import { promoteTools } from './tools/promote.js';
import { diaryWriteTools } from './tools/diary.js';
import { diaryComponentTools, diaryComponentToolNames } from './tools/diaryComponents.js';

export type SubstrateRole = 'mind' | 'diary' | 'cold-start';

// The per-module tool maps are typed with specific zod schemas; we erase that
// here to a uniform Record<string, AnyTool> via an explicit `unknown` cast.
// Safe because tool handlers validate their inputs at runtime via zod.
//
// Substrate access shape:
//   - **Reads** go through `run_sql` (SELECT/WITH/PRAGMA/EXPLAIN against the
//     schema documented in the `substrate-schema` playbook). Read-only for
//     every role — the connection layer enforces it.
//   - **Writes** to the mind model go through small, typed, REST-style tools
//     (`create_anchor`, `update_anchor_layer`, `create_relationship`,
//     `create_prediction`, `support_anchor_precision`, `set_reminder`,
//     `cite`, ...).
//     Server handles ID generation, multi-step atomicity, FK ordering, and
//     arithmetic — all things LLMs are unreliable at.
//   - **Diary OUTPUT writes** (per-template components, thinking-layer,
//     efference prediction) are registry/renderer-contracted, not free
//     mutation. Diary-role only.
const ALL_TOOLS = {
  ...readerTools,
  ...sqlTools,
  ...precisionTools,
  ...anchorTools,
  ...entityTools,
  ...relationshipTools,
  ...predictionTools,
  ...reminderTools,
  ...playTools,
  ...promoteTools,
  ...diaryWriteTools,
  ...diaryComponentTools,
} as unknown as Record<string, AnyTool>;

const MIND_TOOLS: readonly string[] = [
  // reads — open-ended SELECT/WITH/PRAGMA against the documented schema
  'run_sql',
  // file readers (not the mind model)
  'read_profile',
  'list_playbook_sections',
  'read_playbook_section',
  // anchor lifecycle
  'create_anchor',
  'update_anchor_layer',
  'update_anchor_meta',
  'bump_anchor',
  'delete_anchor',
  // entity lifecycle
  'create_entity',
  'bump_entity',
  'update_entity',
  'delete_entity',
  'promote_entity',
  // shared (anchor + entity)
  'update_identity_handles',
  'cite',
  // relationships
  'create_relationship',
  'update_relationship_layer',
  'delete_relationship',
  // predictions
  'create_prediction',
  'delete_prediction',
  // precision arithmetic (server-computed formula + clamp), one tool per target
  'support_anchor_precision',
  'contradict_anchor_precision',
  'support_relationship_precision',
  'contradict_relationship_precision',
  'support_prediction_precision',
  'contradict_prediction_precision',
  // reminders
  'set_reminder',
  'cancel_reminder',
  // plays — derive or refresh persona plays when patterns crystallize
  'create_play',
];

const DIARY_TOOLS: readonly string[] = [
  // single READ-ONLY access to the whole mind model (mutations throw)
  'run_sql',
  // file readers
  'read_profile',
  'list_playbook_sections',
  'read_playbook_section',
  // verify what was written before appending thinking layer
  'read_today_diary',
  // diary OUTPUT writes — per-template family (one tool per renderable shape):
  ...diaryComponentToolNames,
  // and the non-component diary outputs:
  'append_thinking_layer',
  'emit_efference_prediction',
];

// Cold-start uses the full mind toolset — create_play is already included.
const COLD_START_TOOLS: readonly string[] = [...MIND_TOOLS];

export const CATALOG: Record<SubstrateRole, readonly string[]> = {
  mind: MIND_TOOLS,
  diary: DIARY_TOOLS,
  'cold-start': COLD_START_TOOLS,
};

/** Build the registered-tool map for a role. */
export function toolsForRole(role: SubstrateRole): Record<string, AnyTool> {
  const names = CATALOG[role];
  const out: Record<string, AnyTool> = {};
  for (const name of names) {
    const tool = ALL_TOOLS[name];
    if (!tool) {
      throw new Error(
        `catalog drift: tool "${name}" is listed for role "${role}" but not implemented`,
      );
    }
    out[name] = tool;
  }
  return out;
}

/** All tool names defined in the codebase (for diagnostics + cross-checks). */
export const ALL_TOOL_NAMES = Object.keys(ALL_TOOLS) as readonly string[];
