import type { AnchorId, PredictionId } from '@shared/types/ids.js';
import type { LayerName, Precision } from '@shared/types/precision.js';
import { applyContradict, applySupport } from '@shared/types/precision.js';
import type { EvidenceKind, PredictionKind } from '@shared/types/predictions.js';
import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export interface PredictionRow {
  id: PredictionId;
  anchor_id: AnchorId;
  kind: PredictionKind;
  claim: string;
  expected_by: string | null;
  precision: number;
  created_at: string;
  source_dispatchable: string | null;
}

export interface CreatePredictionInput {
  id: string;
  anchor_id: AnchorId;
  kind: PredictionKind;
  claim: string;
  expected_by?: string;
  based_on: LayerName[]; // anchor layers this prediction draws from
  precision: Precision;
  created_at: string;
  source_dispatchable?: string;
}

export interface ApplyEvidenceResult {
  prediction_precision: Precision;
  layer_precisions: Partial<Record<LayerName, Precision>>;
}

export function makePredictionsRepo(db: Db) {
  const stmt = makeStatementCache(db);

  function getLayerPrecision(anchorId: AnchorId, layer: LayerName): Precision | null {
    const col = `${layer}_precision`;
    const row = stmt(`SELECT ${col} as p FROM anchors WHERE id = ?`).get(anchorId) as
      | { p: number | null }
      | undefined;
    return row?.p ?? null;
  }

  function setLayerPrecision(anchorId: AnchorId, layer: LayerName, p: Precision): void {
    const col = `${layer}_precision`;
    stmt(`UPDATE anchors SET ${col} = ? WHERE id = ?`).run(p, anchorId);
  }

  return {
    createPrediction(input: CreatePredictionInput): void {
      const insertPrediction = stmt(
        `INSERT INTO predictions (id, anchor_id, kind, claim, expected_by, precision, created_at, source_dispatchable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertBinding = stmt(
        'INSERT INTO prediction_layer_bindings (prediction_id, anchor_id, layer) VALUES (?, ?, ?)',
      );

      const tx = db.transaction(() => {
        insertPrediction.run(
          input.id,
          input.anchor_id,
          input.kind,
          input.claim,
          input.expected_by ?? null,
          input.precision,
          input.created_at,
          input.source_dispatchable ?? null,
        );
        for (const layer of input.based_on) {
          insertBinding.run(input.id, input.anchor_id, layer);
        }
      });
      tx();
    },

    readPrediction(id: PredictionId): PredictionRow | null {
      return (
        (stmt('SELECT * FROM predictions WHERE id = ?').get(id) as PredictionRow | undefined) ??
        null
      );
    },

    listByAnchor(anchorId: AnchorId): PredictionRow[] {
      return stmt('SELECT * FROM predictions WHERE anchor_id = ?').all(anchorId) as PredictionRow[];
    },

    listByExpectedByBefore(t: string): PredictionRow[] {
      return stmt(
        'SELECT * FROM predictions WHERE expected_by IS NOT NULL AND expected_by < ?',
      ).all(t) as PredictionRow[];
    },

    layersFor(predictionId: PredictionId): LayerName[] {
      return (
        stmt(
          'SELECT layer FROM prediction_layer_bindings WHERE prediction_id = ?',
        ).all(predictionId) as { layer: LayerName }[]
      ).map((r) => r.layer);
    },

    /**
     * Apply evidence to a prediction.
     * Cascades the precision update to every anchor layer the prediction binds to.
     */
    applyEvidence(predictionId: PredictionId, evidence: EvidenceKind): ApplyEvidenceResult | null {
      const pred = stmt('SELECT * FROM predictions WHERE id = ?').get(predictionId) as
        | PredictionRow
        | undefined;
      if (!pred) return null;

      const layers = (
        stmt('SELECT layer, anchor_id FROM prediction_layer_bindings WHERE prediction_id = ?').all(
          predictionId,
        ) as { layer: LayerName; anchor_id: AnchorId }[]
      );

      const tx = db.transaction(() => {
        const nextPred =
          evidence === 'support' ? applySupport(pred.precision) : applyContradict(pred.precision);
        stmt('UPDATE predictions SET precision = ? WHERE id = ?').run(nextPred, predictionId);

        const updated: Partial<Record<LayerName, Precision>> = {};
        for (const binding of layers) {
          const current = getLayerPrecision(binding.anchor_id, binding.layer);
          if (current == null) continue;
          const next = evidence === 'support' ? applySupport(current) : applyContradict(current);
          setLayerPrecision(binding.anchor_id, binding.layer, next);
          updated[binding.layer] = next;
        }
        return { prediction_precision: nextPred, layer_precisions: updated };
      });
      return tx() as ApplyEvidenceResult;
    },

    deletePrediction(id: PredictionId): void {
      stmt('DELETE FROM predictions WHERE id = ?').run(id);
    },
  };
}
