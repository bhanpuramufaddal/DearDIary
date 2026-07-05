import type {
  AnchorId,
  NodeId,
  RelationshipId,
} from '@shared/types/ids.js';
import type { LayerName, Precision } from '@shared/types/precision.js';
import { applySupport, applyContradict } from '@shared/types/precision.js';
import type { EvidenceKind } from '@shared/types/predictions.js';
import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export interface RelationshipRow {
  id: RelationshipId;
  subject_id: NodeId;
  target_id: AnchorId;
  slow_claim: string | null;
  slow_precision: number | null;
  mid_claim: string | null;
  mid_precision: number | null;
  fast_claim: string | null;
  fast_precision: number | null;
}

export interface CreateRelationshipInput {
  id: string;
  subject_id: NodeId;
  target_id: AnchorId;
  slow: { claim: string; precision: Precision };
  mid: { claim: string; precision: Precision };
  fast: { claim: string; precision: Precision };
}

export function makeRelationshipsRepo(db: Db) {
  const stmt = makeStatementCache(db);

  return {
    createRelationship(input: CreateRelationshipInput): void {
      stmt(
        `INSERT INTO relationships (id, subject_id, target_id,
                                    slow_claim, slow_precision,
                                    mid_claim,  mid_precision,
                                    fast_claim, fast_precision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.subject_id,
        input.target_id,
        input.slow.claim,
        input.slow.precision,
        input.mid.claim,
        input.mid.precision,
        input.fast.claim,
        input.fast.precision,
      );
    },

    readRelationship(id: RelationshipId): RelationshipRow | null {
      return (
        (stmt('SELECT * FROM relationships WHERE id = ?').get(id) as
          | RelationshipRow
          | undefined) ?? null
      );
    },

    listRelationshipsBySubject(subjectId: NodeId): RelationshipRow[] {
      return stmt('SELECT * FROM relationships WHERE subject_id = ?').all(subjectId) as RelationshipRow[];
    },

    listRelationshipsByTarget(targetId: AnchorId): RelationshipRow[] {
      return stmt('SELECT * FROM relationships WHERE target_id = ?').all(targetId) as RelationshipRow[];
    },

    /**
     * Apply support/contradict evidence to a relationship layer.
     * Re-uses the same precision arithmetic as predictions.
     */
    updateRelationshipLayer(
      id: RelationshipId,
      layer: LayerName,
      evidence: EvidenceKind,
      claimUpdate?: string,
    ): Precision | null {
      const claimCol = `${layer}_claim`;
      const precisionCol = `${layer}_precision`;
      const row = stmt(`SELECT ${precisionCol} as p FROM relationships WHERE id = ?`).get(id) as
        | { p: number | null }
        | undefined;
      if (!row || row.p == null) return null;

      const next = evidence === 'support' ? applySupport(row.p) : applyContradict(row.p);

      if (claimUpdate !== undefined) {
        stmt(
          `UPDATE relationships SET ${claimCol} = ?, ${precisionCol} = ? WHERE id = ?`,
        ).run(claimUpdate, next, id);
      } else {
        stmt(`UPDATE relationships SET ${precisionCol} = ? WHERE id = ?`).run(next, id);
      }
      return next;
    },

    deleteRelationship(id: RelationshipId): void {
      stmt('DELETE FROM relationships WHERE id = ?').run(id);
    },

    /** Create a relationship row with no layer content. Layers are filled
     *  later via updateRelationshipLayerClaim. */
    createRelationshipMinimal(input: {
      id: string;
      subject_id: NodeId;
      target_id: AnchorId;
    }): void {
      stmt(
        `INSERT INTO relationships (id, subject_id, target_id) VALUES (?, ?, ?)`,
      ).run(input.id, input.subject_id, input.target_id);
    },

    /** Write a layer's claim text + optional initial precision. Distinct from
     *  updateRelationshipLayer (which applies the evidence formula). The new
     *  tool surface uses this for content writes; precision movement goes
     *  through the nudge tools. */
    setLayerClaim(
      id: RelationshipId,
      layer: LayerName,
      claim: string,
      precision?: Precision,
    ): void {
      const claimCol = `${layer}_claim`;
      const precisionCol = `${layer}_precision`;
      if (precision !== undefined) {
        stmt(
          `UPDATE relationships SET ${claimCol} = ?, ${precisionCol} = ? WHERE id = ?`,
        ).run(claim, precision, id);
      } else {
        stmt(`UPDATE relationships SET ${claimCol} = ? WHERE id = ?`).run(claim, id);
      }
    },

    readLayerPrecision(id: RelationshipId, layer: LayerName): number | null {
      const row = stmt(`SELECT ${layer}_precision AS p FROM relationships WHERE id = ?`).get(id) as
        | { p: number | null }
        | undefined;
      return row?.p ?? null;
    },
  };
}
