import type { AnchorId } from '@shared/types/ids.js';
import type { LayerName, Precision } from '@shared/types/precision.js';
import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export interface AnchorRow {
  id: AnchorId;
  display_name: string | null;
  kind: string;
  created_at: string; // joined from nodes.created_at
  activation: number;
  last_bumped: string;
  identity_handles: string; // JSON array
  slow_content: string | null;
  slow_precision: number | null;
  mid_content: string | null;
  mid_precision: number | null;
  fast_content: string | null;
  fast_precision: number | null;
  notes: string | null;
}

export interface CreateAnchorInput {
  id: string;
  kind: string;
  display_name?: string;
  identity_handles: string[];
  slow: { content: string; precision: Precision };
  mid?: { content: string; precision: Precision };
  fast?: { content: string; precision: Precision };
  notes?: string;
  last_bumped: string;
}

/**
 * Minimal anchor creation — no layers required. The new tool surface separates
 * the `create_anchor` step from `update_anchor_layer`, so an anchor row can
 * exist with all three layers NULL until evidence arrives.
 */
export interface CreateAnchorMinimalInput {
  id: string;
  kind: string;
  display_name?: string;
  identity_handles: string[];
  notes?: string;
  last_bumped: string;
}

export function makeAnchorsRepo(db: Db) {
  const stmt = makeStatementCache(db);

  return {
    createAnchor(input: CreateAnchorInput): void {
      stmt(
        `INSERT INTO anchors (id, kind, display_name, activation, last_bumped, identity_handles,
                              slow_content, slow_precision, mid_content, mid_precision,
                              fast_content, fast_precision, notes)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.kind,
        input.display_name ?? null,
        input.last_bumped,
        JSON.stringify(input.identity_handles),
        input.slow.content,
        input.slow.precision,
        input.mid?.content ?? null,
        input.mid?.precision ?? null,
        input.fast?.content ?? null,
        input.fast?.precision ?? null,
        input.notes ?? null,
      );
    },

    readAnchor(id: AnchorId): AnchorRow | null {
      return (
        (stmt(
          `SELECT a.*, n.created_at
           FROM anchors a
           JOIN nodes n ON n.id = a.id
           WHERE a.id = ?`,
        ).get(id) as AnchorRow | undefined) ?? null
      );
    },

    listAnchors(): Pick<
      AnchorRow,
      'id' | 'kind' | 'display_name' | 'activation' | 'last_bumped' | 'created_at'
    >[] {
      return stmt(
        `SELECT a.id, a.kind, a.display_name, a.activation, a.last_bumped, n.created_at
         FROM anchors a JOIN nodes n ON n.id = a.id`,
      ).all() as Pick<
        AnchorRow,
        'id' | 'kind' | 'display_name' | 'activation' | 'last_bumped' | 'created_at'
      >[];
    },

    updateAnchorLayer(
      id: AnchorId,
      layer: LayerName,
      content: string,
      precision?: Precision,
    ): void {
      const contentCol = `${layer}_content`;
      const precisionCol = `${layer}_precision`;
      if (precision !== undefined) {
        stmt(
          `UPDATE anchors SET ${contentCol} = ?, ${precisionCol} = ? WHERE id = ?`,
        ).run(content, precision, id);
      } else {
        stmt(`UPDATE anchors SET ${contentCol} = ? WHERE id = ?`).run(content, id);
      }
    },

    /** Bump activation by `delta`; update `last_bumped` to the current time (caller-provided). */
    bumpActivation(id: AnchorId, delta: number, last_bumped: string): void {
      stmt(
        'UPDATE anchors SET activation = activation + ?, last_bumped = ? WHERE id = ?',
      ).run(delta, last_bumped, id);
    },

    setLayerPrecision(id: AnchorId, layer: LayerName, precision: Precision): void {
      stmt(`UPDATE anchors SET ${layer}_precision = ? WHERE id = ?`).run(precision, id);
    },

    /** Create an anchor row with no layers — content arrives via update_anchor_layer. */
    createAnchorMinimal(input: CreateAnchorMinimalInput): void {
      stmt(
        `INSERT INTO anchors (id, kind, display_name, activation, last_bumped, identity_handles, notes)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
      ).run(
        input.id,
        input.kind,
        input.display_name ?? null,
        input.last_bumped,
        JSON.stringify(input.identity_handles),
        input.notes ?? null,
      );
    },

    updateAnchorMeta(
      id: AnchorId,
      patch: { display_name?: string; kind?: string; notes?: string },
    ): void {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.display_name !== undefined) {
        sets.push('display_name = ?');
        params.push(patch.display_name);
      }
      if (patch.kind !== undefined) {
        sets.push('kind = ?');
        params.push(patch.kind);
      }
      if (patch.notes !== undefined) {
        sets.push('notes = ?');
        params.push(patch.notes);
      }
      if (sets.length === 0) return;
      params.push(id);
      stmt(`UPDATE anchors SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    },

    /** Touch last_bumped only — no activation delta. The new tool surface
     *  separates activation arithmetic (none for now) from a last_bumped touch. */
    bumpAnchor(id: AnchorId, lastBumped: string): void {
      stmt('UPDATE anchors SET last_bumped = ? WHERE id = ?').run(lastBumped, id);
    },

    deleteAnchor(id: AnchorId): void {
      // Goes through nodes; ON DELETE CASCADE wipes anchor + relationships +
      // predictions + case_base.
      stmt('DELETE FROM nodes WHERE id = ?').run(id);
    },

    /** Read just the precision for one layer — used by tool handlers that need
     *  to enforce "initial precision only on first write" semantics. */
    readLayerPrecision(id: AnchorId, layer: LayerName): number | null {
      const row = stmt(`SELECT ${layer}_precision AS p FROM anchors WHERE id = ?`).get(id) as
        | { p: number | null }
        | undefined;
      return row?.p ?? null;
    },

    /** Read just the identity_handles JSON. */
    readIdentityHandles(id: AnchorId): string[] | null {
      const row = stmt('SELECT identity_handles FROM anchors WHERE id = ?').get(id) as
        | { identity_handles: string }
        | undefined;
      if (!row) return null;
      return JSON.parse(row.identity_handles) as string[];
    },

    /** Replace identity_handles wholesale (callers compute the new array). */
    setIdentityHandles(id: AnchorId, handles: string[]): void {
      stmt('UPDATE anchors SET identity_handles = ? WHERE id = ?').run(
        JSON.stringify(handles),
        id,
      );
    },
  };
}
