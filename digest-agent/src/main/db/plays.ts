import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export interface PlayRow {
  name: string;
  title: string;
  content: string;
  derived_from: string | null;
  created_at: string;
}

export interface UpsertPlayInput {
  name: string;
  title: string;
  content: string;
  /** JSON array of source_ids the play generalizes from. */
  derived_from: string[];
  created_at: string;
}

export function makePlaysRepo(db: Db) {
  const stmt = makeStatementCache(db);

  return {
    /** Insert or refresh title/content/derived_from. Created_at is preserved
     *  on conflict so reseeding doesn't churn the timeline. */
    upsertPlay(input: UpsertPlayInput): void {
      stmt(
        `INSERT INTO plays (name, title, content, derived_from, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           title = excluded.title,
           content = excluded.content,
           derived_from = excluded.derived_from`,
      ).run(input.name, input.title, input.content, JSON.stringify(input.derived_from), input.created_at);
    },

    readPlay(name: string): PlayRow | null {
      return (stmt('SELECT * FROM plays WHERE name = ?').get(name) as PlayRow | undefined) ?? null;
    },

    deletePlay(name: string): void {
      stmt('DELETE FROM plays WHERE name = ?').run(name);
    },
  };
}
