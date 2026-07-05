import type { AnchorId, EntityId } from '@shared/types/ids.js';
import type { NodeKind } from '@shared/types/nodes.js';
import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export function makeNodesRepo(db: Db) {
  const stmt = makeStatementCache(db);

  return {
    insertNode(id: string, kind: NodeKind, createdAt: string): void {
      stmt('INSERT INTO nodes (id, kind, created_at) VALUES (?, ?, ?)').run(id, kind, createdAt);
    },

    getNodeKind(id: string): NodeKind | null {
      const row = stmt('SELECT kind FROM nodes WHERE id = ?').get(id) as
        | { kind: NodeKind }
        | undefined;
      return row?.kind ?? null;
    },

    /** Flip a node from entity → anchor (used during promotion). */
    setNodeKind(id: string, kind: NodeKind): void {
      stmt('UPDATE nodes SET kind = ? WHERE id = ?').run(kind, id);
    },

    /** Delete by id. ON DELETE CASCADE handles related tables. */
    deleteNode(id: AnchorId | EntityId): void {
      stmt('DELETE FROM nodes WHERE id = ?').run(id);
    },
  };
}
