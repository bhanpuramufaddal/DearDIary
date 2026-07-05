import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { openDatabase, type Db } from './db/index.js';
import { applyMigrations } from './db/migrate.js';
import { seedPrompts } from './db/seedPrompts.js';
import { loadSystemPrompt, composeSystemPrompt, COLD_START_VALIDATOR_NAME } from './prompts.js';

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-prompts-'));
  db = openDatabase(join(tmp, 'test.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Seed a minimal set of prompts directly into the DB for tests. */
function insertPrompt(name: string, content: string, kind = 'agent'): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO prompts (name, kind, title, content, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'bundled', ?, ?)
  `).run(name, kind, name, content, now, now);
}

describe('loadSystemPrompt', () => {
  it('composes disposition + role prompt from DB', () => {
    insertPrompt('disposition', 'DISPOSITION content');
    insertPrompt('mind-agent', 'MIND content');

    const p = loadSystemPrompt('mind', db);
    expect(p).toContain('DISPOSITION content');
    expect(p).toContain('MIND content');
    expect(p.indexOf('DISPOSITION content')).toBeLessThan(p.indexOf('MIND content'));
  });

  it('throws when a required prompt is missing from DB', () => {
    // disposition missing — nothing seeded
    expect(() => loadSystemPrompt('mind', db)).toThrow(/prompt not found in DB.*disposition/);
  });

  it('throws when the role prompt is missing from DB', () => {
    insertPrompt('disposition', 'disp');
    // mind-agent not seeded
    expect(() => loadSystemPrompt('mind', db)).toThrow(/prompt not found in DB.*mind-agent/);
  });

  it('composes correctly for each agent role', () => {
    insertPrompt('disposition', 'shared');
    insertPrompt('mind-agent', 'mind');
    insertPrompt('diary-agent', 'diary');
    insertPrompt('cold-start-agent', 'cold');
    insertPrompt('execution-agent', 'exec');

    expect(loadSystemPrompt('mind', db)).toContain('mind');
    expect(loadSystemPrompt('diary', db)).toContain('diary');
    expect(loadSystemPrompt('cold-start', db)).toContain('cold');
    expect(loadSystemPrompt('execution', db)).toContain('exec');
  });
});

describe('composeSystemPrompt', () => {
  it('composes disposition + arbitrary name for out-of-role prompts', () => {
    insertPrompt('disposition', 'BASE');
    insertPrompt(COLD_START_VALIDATOR_NAME, 'VALIDATOR');

    const p = composeSystemPrompt(COLD_START_VALIDATOR_NAME, db);
    expect(p).toContain('BASE');
    expect(p).toContain('VALIDATOR');
  });
});

describe('seedPrompts', () => {
  it('loads all bundled agent + playbook prompts into the DB', () => {
    const count = seedPrompts(db, tmp);
    expect(count).toBeGreaterThan(0);

    const rows = db.prepare(`SELECT name, kind FROM prompts ORDER BY name`).all() as { name: string; kind: string }[];
    const agentNames = rows.filter((r) => r.kind === 'agent').map((r) => r.name);
    const playbookNames = rows.filter((r) => r.kind === 'playbook').map((r) => r.name);

    // All six agent prompts must be present.
    expect(agentNames).toContain('disposition');
    expect(agentNames).toContain('mind-agent');
    expect(agentNames).toContain('diary-agent');
    expect(agentNames).toContain('cold-start-agent');
    expect(agentNames).toContain('cold-start-validator-agent');
    expect(agentNames).toContain('execution-agent');

    // Playbook sections must be present.
    expect(playbookNames.some((n) => n.startsWith('playbook/'))).toBe(true);
    expect(playbookNames).toContain('playbook/customize');
    expect(playbookNames).toContain('playbook/substrate-schema');
  });

  it('applies a local override when one exists in digestDir', () => {
    writeFileSync(join(tmp, 'disposition.md'), 'LOCAL disposition override');
    seedPrompts(db, tmp);

    const row = db.prepare(`SELECT content, source FROM prompts WHERE name = 'disposition'`).get() as
      | { content: string; source: string }
      | undefined;
    expect(row?.content).toBe('LOCAL disposition override');
    expect(row?.source).toBe('override');
  });

  it('marks bundled prompts as source=bundled when no override exists', () => {
    seedPrompts(db, tmp);
    const row = db.prepare(`SELECT source FROM prompts WHERE name = 'mind-agent'`).get() as
      | { source: string }
      | undefined;
    expect(row?.source).toBe('bundled');
  });

  it('is idempotent — re-seeding updates content but does not duplicate rows', () => {
    const first = seedPrompts(db, tmp);
    const second = seedPrompts(db, tmp);
    expect(first).toBe(second);
    const total = (db.prepare('SELECT COUNT(*) AS n FROM prompts').get() as { n: number }).n;
    expect(total).toBe(first);
  });

  it('does not include seed-plays files in the prompts table', () => {
    seedPrompts(db, tmp);
    const rows = db.prepare(`SELECT name FROM prompts WHERE name LIKE 'seed-plays%' OR name LIKE '%/seed-plays/%'`).all();
    expect(rows).toHaveLength(0);
  });
});
