/**
 * Precision-nudge tools — one tool per (direction × target).
 *
 * The mind agent's only mechanism for moving precision up or down on a
 * standing belief: an anchor layer, a relationship layer, or a prediction.
 * The agent picks the direction by tool name; the math and the
 * [0.05, 0.95] clamp are computed server-side. This keeps the arithmetic
 * out of the LLM (which is unreliable at it) and out of the
 * `agent_tool_calls` audit log as raw SQL.
 *
 * Formula (the same across all six tools):
 *   support     → p + (1 - p) * 0.1
 *   contradict  → p - p * 0.3
 *   result      → clamp to [0.05, 0.95]
 *
 * Tools are split by target so each input schema is trivially correct-by-
 * construction: anchor / relationship nudges take `{ id, layer }`; prediction
 * nudges take `{ id }`. No cross-field conditional, no discriminated union.
 * Aligns with the rest of the typed-tool catalog (`create_anchor`,
 * `update_anchor_layer`, `create_relationship`, `create_prediction`, ...).
 *
 * Mind-only. Diary is read-only (catalog never lists these for diary). Cold-
 * start seeds at initial precision and doesn't nudge — the tools are listed
 * for symmetry but mostly unused in that role.
 */

import { z } from 'zod';
import { defineTool, type ToolContext } from '../tool.js';

export const PRECISION_FLOOR = 0.05;
export const PRECISION_CEIL = 0.95;
export const SUPPORT_NUDGE = 0.1;
export const CONTRADICT_NUDGE = 0.3;

export type NudgeDirection = 'support' | 'contradict';

/** Apply the precision formula + clamp. Pure; exported for tests. */
export function applyNudge(p: number, direction: NudgeDirection): number {
  const raw =
    direction === 'support' ? p + (1 - p) * SUPPORT_NUDGE : p - p * CONTRADICT_NUDGE;
  return Math.max(PRECISION_FLOOR, Math.min(PRECISION_CEIL, raw));
}

type Target = 'anchor' | 'relationship' | 'prediction';

interface NudgeResult {
  target: Target;
  id: string;
  layer?: 'slow' | 'mid' | 'fast';
  direction: NudgeDirection;
  old_precision: number;
  new_precision: number;
}

const layerInput = z
  .object({
    id: z.string().min(1),
    layer: z.enum(['slow', 'mid', 'fast']),
  })
  .strict();

const idOnlyInput = z.object({ id: z.string().min(1) }).strict();

function nudgeRow(
  ctx: ToolContext,
  table: string,
  column: string,
  id: string,
  errorLabel: string,
  direction: NudgeDirection,
): { oldP: number; newP: number } {
  const row = ctx.db
    .prepare(`SELECT ${column} AS p FROM ${table} WHERE id = ?`)
    .get(id) as { p: number | null } | undefined;
  if (!row) throw new Error(`${errorLabel} not found: ${id}`);
  if (row.p === null || row.p === undefined) {
    throw new Error(
      `precision is not set yet on this ${errorLabel}; set an initial value before nudging`,
    );
  }
  const newP = applyNudge(row.p, direction);
  ctx.db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(newP, id);
  return { oldP: row.p, newP };
}

export const supportAnchorPrecision = defineTool({
  name: 'support_anchor_precision',
  description:
    "Nudge precision UP on an anchor layer — the evidence supports it. Applies p → p + (1-p)*0.1 server-side and clamps to [0.05, 0.95]. Pass anchor id + layer (slow/mid/fast). Returns { target:'anchor', id, layer, direction:'support', old_precision, new_precision }. Throws if the anchor is missing or the layer's precision is NULL (set an initial value via update_anchor_layer first).",
  input: layerInput,
  handler: (args, ctx: ToolContext): NudgeResult => {
    const errorLabel = `anchor/${args.layer}`;
    const { oldP, newP } = nudgeRow(
      ctx,
      'anchors',
      `${args.layer}_precision`,
      args.id,
      errorLabel,
      'support',
    );
    return {
      target: 'anchor',
      id: args.id,
      layer: args.layer,
      direction: 'support',
      old_precision: oldP,
      new_precision: newP,
    };
  },
});

export const contradictAnchorPrecision = defineTool({
  name: 'contradict_anchor_precision',
  description:
    "Nudge precision DOWN on an anchor layer — the evidence contradicts it. Applies p → p - p*0.3 server-side and clamps to [0.05, 0.95]. Pass anchor id + layer (slow/mid/fast). Returns { target:'anchor', id, layer, direction:'contradict', old_precision, new_precision }. Throws if the anchor is missing or the layer's precision is NULL.",
  input: layerInput,
  handler: (args, ctx: ToolContext): NudgeResult => {
    const errorLabel = `anchor/${args.layer}`;
    const { oldP, newP } = nudgeRow(
      ctx,
      'anchors',
      `${args.layer}_precision`,
      args.id,
      errorLabel,
      'contradict',
    );
    return {
      target: 'anchor',
      id: args.id,
      layer: args.layer,
      direction: 'contradict',
      old_precision: oldP,
      new_precision: newP,
    };
  },
});

export const supportRelationshipPrecision = defineTool({
  name: 'support_relationship_precision',
  description:
    "Nudge precision UP on a relationship layer — the evidence supports it. Applies p → p + (1-p)*0.1 server-side and clamps to [0.05, 0.95]. Pass relationship id + layer (slow/mid/fast). Returns { target:'relationship', id, layer, direction:'support', old_precision, new_precision }. Throws if the relationship is missing or the layer's precision is NULL (set an initial value via update_relationship_layer first).",
  input: layerInput,
  handler: (args, ctx: ToolContext): NudgeResult => {
    const errorLabel = `relationship/${args.layer}`;
    const { oldP, newP } = nudgeRow(
      ctx,
      'relationships',
      `${args.layer}_precision`,
      args.id,
      errorLabel,
      'support',
    );
    return {
      target: 'relationship',
      id: args.id,
      layer: args.layer,
      direction: 'support',
      old_precision: oldP,
      new_precision: newP,
    };
  },
});

export const contradictRelationshipPrecision = defineTool({
  name: 'contradict_relationship_precision',
  description:
    "Nudge precision DOWN on a relationship layer — the evidence contradicts it. Applies p → p - p*0.3 server-side and clamps to [0.05, 0.95]. Pass relationship id + layer (slow/mid/fast). Returns { target:'relationship', id, layer, direction:'contradict', old_precision, new_precision }. Throws if the relationship is missing or the layer's precision is NULL.",
  input: layerInput,
  handler: (args, ctx: ToolContext): NudgeResult => {
    const errorLabel = `relationship/${args.layer}`;
    const { oldP, newP } = nudgeRow(
      ctx,
      'relationships',
      `${args.layer}_precision`,
      args.id,
      errorLabel,
      'contradict',
    );
    return {
      target: 'relationship',
      id: args.id,
      layer: args.layer,
      direction: 'contradict',
      old_precision: oldP,
      new_precision: newP,
    };
  },
});

export const supportPredictionPrecision = defineTool({
  name: 'support_prediction_precision',
  description:
    "Nudge precision UP on a prediction — the world supports its claim. Applies p → p + (1-p)*0.1 server-side and clamps to [0.05, 0.95]. Pass prediction id. Returns { target:'prediction', id, direction:'support', old_precision, new_precision }. Throws if the prediction is missing or its precision is NULL.",
  input: idOnlyInput,
  handler: (args, ctx: ToolContext): NudgeResult => {
    const { oldP, newP } = nudgeRow(
      ctx,
      'predictions',
      'precision',
      args.id,
      'prediction',
      'support',
    );
    return {
      target: 'prediction',
      id: args.id,
      direction: 'support',
      old_precision: oldP,
      new_precision: newP,
    };
  },
});

export const contradictPredictionPrecision = defineTool({
  name: 'contradict_prediction_precision',
  description:
    "Nudge precision DOWN on a prediction — the world contradicts its claim. Applies p → p - p*0.3 server-side and clamps to [0.05, 0.95]. Pass prediction id. Returns { target:'prediction', id, direction:'contradict', old_precision, new_precision }. Throws if the prediction is missing or its precision is NULL.",
  input: idOnlyInput,
  handler: (args, ctx: ToolContext): NudgeResult => {
    const { oldP, newP } = nudgeRow(
      ctx,
      'predictions',
      'precision',
      args.id,
      'prediction',
      'contradict',
    );
    return {
      target: 'prediction',
      id: args.id,
      direction: 'contradict',
      old_precision: oldP,
      new_precision: newP,
    };
  },
});

export const precisionTools = {
  [supportAnchorPrecision.name]: supportAnchorPrecision,
  [contradictAnchorPrecision.name]: contradictAnchorPrecision,
  [supportRelationshipPrecision.name]: supportRelationshipPrecision,
  [contradictRelationshipPrecision.name]: contradictRelationshipPrecision,
  [supportPredictionPrecision.name]: supportPredictionPrecision,
  [contradictPredictionPrecision.name]: contradictPredictionPrecision,
};
