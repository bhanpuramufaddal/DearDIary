import type { EntityId } from '@shared/types/ids.js';
import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export interface EntityRow {
  id: EntityId;
  kind_hint: string | null;
  first_seen: string;
  last_seen: string;
  mention_count: number;
  identity_handles: string; // JSON array
  notes: string | null;
}

export interface CreateEntityInput {
  id: string;
  kind: string;
  identity_handles: string[];
  notes?: string;
  first_seen: string;
}

export function makeEntitiesRepo(db: Db) {
  const stmt = makeStatementCache(db);

  return {
    createEntity(input: CreateEntityInput): void {
      stmt(
        `INSERT INTO entities (id, kind_hint, first_seen, last_seen, mention_count, identity_handles, notes)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        input.id,
        input.kind,
        input.first_seen,
        input.first_seen,
        JSON.stringify(input.identity_handles),
        input.notes ?? null,
      );
    },

    readEntity(id: EntityId): EntityRow | null {
      return (stmt('SELECT * FROM entities WHERE id = ?').get(id) as EntityRow | undefined) ?? null;
    },

    listEntities(): Pick<EntityRow, 'id' | 'kind_hint' | 'mention_count' | 'last_seen'>[] {
      return stmt(
        'SELECT id, kind_hint, mention_count, last_seen FROM entities',
      ).all() as Pick<EntityRow, 'id' | 'kind_hint' | 'mention_count' | 'last_seen'>[];
    },

    updateEntityNotes(id: EntityId, notes: string): void {
      stmt('UPDATE entities SET notes = ? WHERE id = ?').run(notes, id);
    },

    bumpMentionCount(id: EntityId, lastSeen: string): void {
      stmt(
        'UPDATE entities SET mention_count = mention_count + 1, last_seen = ? WHERE id = ?',
      ).run(lastSeen, id);
    },

    markLastSeen(id: EntityId, lastSeen: string): void {
      stmt('UPDATE entities SET last_seen = ? WHERE id = ?').run(lastSeen, id);
    },

    /** Partial update — only the fields the caller passes are touched. */
    updateEntity(
      id: EntityId,
      patch: { kind_hint?: string; notes?: string },
    ): void {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.kind_hint !== undefined) {
        sets.push('kind_hint = ?');
        params.push(patch.kind_hint);
      }
      if (patch.notes !== undefined) {
        sets.push('notes = ?');
        params.push(patch.notes);
      }
      if (sets.length === 0) return;
      params.push(id);
      stmt(`UPDATE entities SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    },

    /** Delete via nodes — ON DELETE CASCADE wipes entity + relationships + case_base. */
    deleteEntity(id: EntityId): void {
      stmt('DELETE FROM nodes WHERE id = ?').run(id);
    },

    readIdentityHandles(id: EntityId): string[] | null {
      const row = stmt('SELECT identity_handles FROM entities WHERE id = ?').get(id) as
        | { identity_handles: string }
        | undefined;
      if (!row) return null;
      return JSON.parse(row.identity_handles) as string[];
    },

    setIdentityHandles(id: EntityId, handles: string[]): void {
      stmt('UPDATE entities SET identity_handles = ? WHERE id = ?').run(
        JSON.stringify(handles),
        id,
      );
    },
  };
}
