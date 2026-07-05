/**
 * Prediction tools.
 *
 * Predictions are forward-looking claims about an anchor — kind ∈
 * event|fact|pattern. `expected_by` is required iff kind='event' (a CHECK
 * enforces it at the SQL layer; we also pre-check at the tool boundary for a
 * clearer error). Each prediction binds to one or more anchor layers via
 * `prediction_layer_bindings`; create_prediction writes both atomically.
 *
 * Precision arithmetic — support / contradict — lives in the existing
 * `support_prediction_precision({id})` / `contradict_prediction_precision`
 * tools. This module only creates and deletes.
 */

import { z } from 'zod';
import { defineTool } from '../tool.js';
import { makeAnchorsRepo } from '../../../db/anchors.js';
import { makePredictionsRepo } from '../../../db/predictions.js';
import { PRECISION_MIN, PRECISION_MAX } from '@shared/types/precision.js';
import type { AnchorId, PredictionId } from '@shared/types/ids.js';
import { genId } from './_ids.js';

const layerSchema = z.enum(['slow', 'mid', 'fast']);
const precisionSchema = z.number().min(PRECISION_MIN).max(PRECISION_MAX);
const idSchema = z.string().min(1).max(128).regex(/^_?[a-z][\w-]*$/i, 'id must match /^_?[a-z][\\w-]*$/i');
const predIdSchema = z.string().min(1).max(128).regex(/^pred_[\w-]+$/, 'prediction id must match /^pred_[\\w-]+$/');

// ─── create_prediction ─────────────────────────────────────────────────────

export const createPrediction = defineTool({
  name: 'create_prediction',
  description:
    "Create a standing prediction on an anchor. `kind='event'` REQUIRES `expected_by` (ISO 8601 with tz offset); `kind='fact'` and `kind='pattern'` MUST NOT have `expected_by`. `based_on` is the list of anchor layers this prediction draws from (slow / mid / fast). Server-generated id (`pred_…`). Atomic: inserts the prediction row + binding rows in one transaction.",
  input: z
    .object({
      anchor_id: idSchema,
      kind: z.enum(['event', 'fact', 'pattern']),
      claim: z.string().min(1).max(4000),
      expected_by: z.string().datetime({ offset: true }).optional(),
      precision: precisionSchema,
      based_on: z.array(layerSchema).min(1),
      source_dispatchable: z.string().optional(),
    })
    .strict()
    .refine(
      (v) =>
        v.kind === 'event' ? v.expected_by !== undefined : v.expected_by === undefined,
      {
        message:
          "expected_by is required iff kind='event'. For 'fact' and 'pattern', omit it.",
        path: ['expected_by'],
      },
    ),
  handler: (args, ctx) => {
    const anchors = makeAnchorsRepo(ctx.db);
    if (!anchors.readAnchor(args.anchor_id as AnchorId)) {
      throw new Error(`anchor not found: ${args.anchor_id}`);
    }

    const predictions = makePredictionsRepo(ctx.db);
    const id = genId('pred');
    predictions.createPrediction({
      id,
      anchor_id: args.anchor_id as AnchorId,
      kind: args.kind,
      claim: args.claim,
      ...(args.expected_by ? { expected_by: args.expected_by } : {}),
      based_on: args.based_on,
      precision: args.precision,
      created_at: ctx.now(),
      ...(args.source_dispatchable ? { source_dispatchable: args.source_dispatchable } : {}),
    });
    return { id };
  },
});

// ─── delete_prediction ─────────────────────────────────────────────────────

export const deletePrediction = defineTool({
  name: 'delete_prediction',
  description:
    "Delete a prediction the agent has deemed irrelevant (the world has moved on, or the prediction is structurally wrong). Cascades to prediction_layer_bindings via FK.",
  input: z.object({ id: predIdSchema }).strict(),
  handler: (args, ctx) => {
    const predictions = makePredictionsRepo(ctx.db);
    if (!predictions.readPrediction(args.id as PredictionId)) {
      throw new Error(`prediction not found: ${args.id}`);
    }
    predictions.deletePrediction(args.id as PredictionId);
    return { ok: true as const, id: args.id };
  },
});

export const predictionTools = {
  [createPrediction.name]: createPrediction,
  [deletePrediction.name]: deletePrediction,
};
