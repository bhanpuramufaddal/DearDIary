/**
 * SQLite connection management.
 *
 * One main-process connection is enough for our use; substrate MCP server
 * subprocesses open their own connections (WAL keeps them coherent).
 */

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type { Db };

export function openDatabase(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL'); // WAL+NORMAL is the default fast+durable combo
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Tiny prepared-statement cache. Each module keeps its own cache via this helper
 * to avoid the cost of `prepare()` on every call.
 */
export function makeStatementCache(db: Db) {
  const cache = new Map<string, Database.Statement>();
  return function get(sql: string): Database.Statement {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };
}
