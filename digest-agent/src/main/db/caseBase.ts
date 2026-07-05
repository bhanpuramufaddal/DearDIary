import type { CaseBaseEntryId, NodeId, SourceId } from '@shared/types/ids.js';
import type { LayerName } from '@shared/types/precision.js';
import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export interface CaseBaseRow {
  id: CaseBaseEntryId;
  node_id: NodeId;
  layer: LayerName | null;
  source_id: SourceId;
  date: string;
  note: string | null;
  position: number;
}

export interface AddCaseBaseEntryInput {
  id: string;
  node_id: NodeId;
  layer: LayerName | null;
  source_id: SourceId;
  date: string;
  note?: string;
  /** When undefined, position is auto-incremented to be the max+1 within (node_id, layer). */
  position?: number;
}

export function makeCaseBaseRepo(db: Db) {
  const stmt = makeStatementCache(db);

  return {
    addEntry(input: AddCaseBaseEntryInput): number {
      const position =
        input.position ??
        (() => {
          const row = stmt(
            'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM case_base_entries WHERE node_id = ? AND ((layer IS NULL AND ?  IS NULL) OR layer = ?)',
          ).get(input.node_id, input.layer, input.layer) as { next: number };
          return row.next;
        })();

      stmt(
        `INSERT INTO case_base_entries (id, node_id, layer, source_id, date, note, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.node_id, input.layer, input.source_id, input.date, input.note ?? null, position);

      return position;
    },

    listByNodeLayer(nodeId: NodeId, layer: LayerName | null): CaseBaseRow[] {
      return stmt(
        `SELECT * FROM case_base_entries
         WHERE node_id = ?
           AND ((layer IS NULL AND ? IS NULL) OR layer = ?)
         ORDER BY position ASC`,
      ).all(nodeId, layer, layer) as CaseBaseRow[];
    },

    listBySourceId(sourceId: SourceId): CaseBaseRow[] {
      return stmt('SELECT * FROM case_base_entries WHERE source_id = ?').all(
        sourceId,
      ) as CaseBaseRow[];
    },

    /** Re-layer an entry — used during promotion (entity case_base → anchor slow layer). */
    setLayer(id: CaseBaseEntryId, layer: LayerName | null): void {
      stmt('UPDATE case_base_entries SET layer = ? WHERE id = ?').run(layer, id);
    },

    deleteEntry(id: CaseBaseEntryId): void {
      stmt('DELETE FROM case_base_entries WHERE id = ?').run(id);
    },
  };
}
