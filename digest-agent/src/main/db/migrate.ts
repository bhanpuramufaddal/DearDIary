/**
 * Migration runner.
 *
 * Reads numbered SQL files from `migrations/` (e.g. `001_init.sql`, `002_*.sql`)
 * and applies them in order, tracking the applied version in SQLite's
 * built-in `PRAGMA user_version`.
 *
 * Idempotent: re-running calls run nothing if user_version already matches the
 * highest available migration.
 *
 * The plan calls for `@blackglory/better-sqlite3-migrations`. We wrap it here.
 */

import { migrate as runMigrations } from '@blackglory/better-sqlite3-migrations';
import type { Db } from './index.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrationFile {
  version: number;
  filename: string;
  sql: string;
}

export function loadMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((filename) => {
      const match = /^(\d+)_/.exec(filename);
      if (!match || !match[1]) {
        throw new Error(`migration filename must start with a number: ${filename}`);
      }
      const version = Number(match[1]);
      const sql = readFileSync(join(dir, filename), 'utf-8');
      return { version, filename, sql };
    })
    .sort((a, b) => a.version - b.version);
}

export function applyMigrations(db: Db, dir: string): { applied: number; latest: number } {
  const migrations = loadMigrations(dir);
  if (migrations.length === 0) {
    return { applied: 0, latest: 0 };
  }

  const before = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  runMigrations(
    db,
    migrations.map((m) => ({ version: m.version, up: m.sql, down: '' })),
    { targetVersion: migrations[migrations.length - 1]!.version },
  );

  const after = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  return { applied: after - before, latest: after };
}
