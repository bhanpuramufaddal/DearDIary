/**
 * Diary write tools — available to the diary agent role only.
 *
 * write_diary persists today's components (UPSERT-by-id; comments survive
 * across re-ticks). append_thinking_layer adds to the day's reasoning journal.
 * emit_efference_prediction creates a prediction on the primary anchor of a
 * dispatchable component, with source_dispatchable set so the outcome closes
 * the loop later.
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import { defineTool } from '../tool.js';
import { makeDiaryRepo } from '../../../db/diary.js';
import { makePredictionsRepo } from '../../../db/predictions.js';
import { diarySchema } from '@shared/schemas/index.js';
import type { Diary } from '@shared/types/diary.js';
import type { AnchorId, PredictionId } from '@shared/types/ids.js';

const layerNameSchema = z.enum(['slow', 'mid', 'fast']);
const precisionSchema = z.number().min(0.05).max(0.95);

export const writeDiary = defineTool({
  name: 'write_diary',
  description:
    "Persist today's diary JSON. Components are upserted by id, so comments survive across re-ticks; components dropped from the new payload (and their comments) are removed. Notes and thinking entries are NOT touched — use diary_add_note / append_thinking_layer for those.",
  input: z.object({ diary: diarySchema }).strict(),
  handler: (args, ctx) => {
    // The zod schema validates the on-the-wire shape (plain strings); the storage
    // layer types use branded ids. Branded types are TS-only — runtime identical.
    const diary = makeDiaryRepo(ctx.db);
    diary.persistDiary(args.diary as unknown as Diary);
    return { date: args.diary.date };
  },
});

export const appendThinkingLayer = defineTool({
  name: 'append_thinking_layer',
  description:
    "Append a reasoning-journal entry to the day's thinking_layer. Inner-mode voice, verbose, evidence-anchored — this is the audit trail for the day's tick.",
  input: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      tick_at: z.string().datetime({ offset: true }),
      entries: z.array(z.string().max(4000)).min(1),
    })
    .strict(),
  handler: (args, ctx) => {
    const diary = makeDiaryRepo(ctx.db);
    const id = nanoid();
    diary.appendThinkingEntry(args.date, id, args.tick_at, args.entries);
    return { id };
  },
});

export const emitEfferencePrediction = defineTool({
  name: 'emit_efference_prediction',
  description:
    "Attach an efference-copy prediction to an anchor and link it to a dispatchable diary component. The prediction has source_dispatchable set to `diary/<date>#<component_id>`; the mind agent later resolves it when the world responds.",
  input: z
    .object({
      id: z.string().min(1).max(128),
      anchor_id: z.string().min(1),
      diary_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      component_id: z.string().min(1),
      claim: z.string().min(1).max(2000),
      expected_by: z.string().datetime({ offset: true }),
      based_on: z.array(layerNameSchema).min(1),
      precision: precisionSchema,
    })
    .strict(),
  handler: (args, ctx) => {
    const predictions = makePredictionsRepo(ctx.db);
    const sourceDispatchable = `diary/${args.diary_date}#${args.component_id}`;

    // Both writes in one transaction: if the component_id is bad and the link
    // fails, the prediction itself rolls back too — no orphaned prediction
    // sitting on the anchor with no diary back-reference.
    const tx = ctx.db.transaction(() => {
      predictions.createPrediction({
        id: args.id,
        anchor_id: args.anchor_id as AnchorId,
        kind: 'event',
        claim: args.claim,
        expected_by: args.expected_by,
        based_on: args.based_on,
        precision: args.precision,
        created_at: ctx.now(),
        source_dispatchable: sourceDispatchable,
      });
      const linkRes = ctx.db
        .prepare('UPDATE diary_components SET efference_prediction_id = ? WHERE id = ?')
        .run(args.id, args.component_id);
      if (linkRes.changes === 0) {
        throw new Error(`diary component not found: ${args.component_id}`);
      }
    });
    tx();

    return { prediction_id: args.id as PredictionId, source_dispatchable: sourceDispatchable };
  },
});

export const diaryWriteTools = {
  [writeDiary.name]: writeDiary,
  [appendThinkingLayer.name]: appendThinkingLayer,
  [emitEfferencePrediction.name]: emitEfferencePrediction,
};
