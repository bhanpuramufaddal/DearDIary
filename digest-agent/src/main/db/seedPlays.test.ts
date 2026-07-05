import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDatabase, type Db } from './index.js';
import { applyMigrations } from './migrate.js';
import { migrationsDir } from './migrations-path.js';
import {
  seedHousePlays,
  seedFileToPlayName,
  HOWTO_PLAY_PREFIX,
  REASONING_PLAY_PREFIX,
  TRIAGE_PLAY_PREFIX,
} from './seedPlays.js';

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'seed-plays-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, migrationsDir());
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('seedFileToPlayName', () => {
  it('converts {prefix}-{slug}.md to {prefix}:{slug}', () => {
    expect(seedFileToPlayName('howto-voice.md')).toBe('howto:voice');
    expect(seedFileToPlayName('reasoning-notice-and-name.md')).toBe('reasoning:notice-and-name');
    expect(seedFileToPlayName('triage-busy-morning.md')).toBe('triage:busy-morning');
  });

  it('throws when filename has no dash separator', () => {
    expect(() => seedFileToPlayName('nodash.md')).toThrow('convention');
  });
});

describe('seedHousePlays', () => {
  it('seeds all bundled house plays across all prefixes', () => {
    const n = seedHousePlays(db);
    // howto (3) + reasoning (12) + triage (3) = 18 minimum
    expect(n).toBeGreaterThanOrEqual(18);

    const all = db
      .prepare(`SELECT name, title, content, derived_from FROM plays`)
      .all() as { name: string; title: string; content: string; derived_from: string }[];
    expect(all.length).toBe(n);
    for (const r of all) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.content.length).toBeGreaterThan(0);
      expect(r.derived_from).toBe('__house_seed__');
    }

    const names = all.map((r) => r.name);
    // howto plays
    expect(names).toContain('howto:situation-handling');
    expect(names).toContain('howto:voice');
    expect(names).toContain('howto:suppression');
    // triage plays
    expect(names).toContain('triage:busy-morning');
    expect(names).toContain('triage:quiet-morning');
    expect(names).toContain('triage:recurring-matter');
    // reasoning plays (spot-check)
    expect(names).toContain('reasoning:notice-and-name');
    expect(names).toContain('reasoning:land-with-falsifier');
  });

  it('is idempotent — re-running does not duplicate rows', () => {
    const first = seedHousePlays(db);
    const second = seedHousePlays(db);
    expect(second).toBe(first);
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM plays`).get() as { n: number }).n;
    expect(count).toBe(first);
  });

  it('seeds plays with the correct namespace prefixes', () => {
    seedHousePlays(db);
    const howtos = (
      db
        .prepare(`SELECT name FROM plays WHERE name LIKE '${HOWTO_PLAY_PREFIX}%'`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    const reasonings = (
      db
        .prepare(`SELECT name FROM plays WHERE name LIKE '${REASONING_PLAY_PREFIX}%'`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    const triages = (
      db
        .prepare(`SELECT name FROM plays WHERE name LIKE '${TRIAGE_PLAY_PREFIX}%'`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(howtos.length).toBe(3);
    expect(reasonings.length).toBe(12);
    expect(triages.length).toBe(3);
  });
});
