import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createSubstrateServer, type SubstrateServer } from './server.js';

const T0 = '2026-05-25T12:00:00-07:00';

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-sql-test-'));
  dbPath = join(tmp, 'digest.db');
  mkdirSync(join(tmp, 'plays'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function build(role: 'mind' | 'diary' | 'cold-start'): SubstrateServer {
  return createSubstrateServer({ role, dbPath, digestDir: tmp, now: () => T0 });
}

describe('run_sql — SELECT works for every role', () => {
  for (const role of ['mind', 'diary', 'cold-start'] as const) {
    it(`${role}: SELECT returns rows`, async () => {
      const server = build(role);
      const res = (await server.callTool('run_sql', {
        sql: "SELECT 1 AS one",
      })) as { rows: { one: number }[]; row_count: number };
      expect(res.row_count).toBe(1);
      expect(res.rows[0]).toEqual({ one: 1 });
    });
  }
});

describe('run_sql — read-only enforcement for every role', () => {
  for (const role of ['mind', 'diary', 'cold-start'] as const) {
    it(`${role}: INSERT throws`, async () => {
      const server = build(role);
      await expect(
        server.callTool('run_sql', {
          sql: 'INSERT INTO nodes (id, kind, created_at) VALUES (?, ?, ?)',
          params: ['x', 'anchor', T0],
        }),
      ).rejects.toThrow();
    });

    it(`${role}: UPDATE throws`, async () => {
      const server = build(role);
      await expect(
        server.callTool('run_sql', { sql: "UPDATE anchors SET slow_content = 'z' WHERE id = 'x'" }),
      ).rejects.toThrow();
    });

    it(`${role}: DELETE throws`, async () => {
      const server = build(role);
      await expect(
        server.callTool('run_sql', { sql: "DELETE FROM nodes WHERE id = 'x'" }),
      ).rejects.toThrow();
    });
  }
});

describe('run_sql — bound params', () => {
  it('positional binds via array', async () => {
    const mind = build('mind');
    await mind.callTool('create_anchor', { display_name: 'M' });
    const res = (await mind.callTool('run_sql', {
      sql: 'SELECT id FROM anchors WHERE id = ?',
      params: ['m'],
    })) as { rows: { id: string }[] };
    expect(res.rows[0]!.id).toBe('m');
  });

  it('named binds via object', async () => {
    const mind = build('mind');
    await mind.callTool('create_anchor', { display_name: 'M' });
    const res = (await mind.callTool('run_sql', {
      sql: 'SELECT id FROM anchors WHERE id = :id',
      params: { id: 'm' },
    })) as { rows: { id: string }[] };
    expect(res.rows[0]!.id).toBe('m');
  });
});

describe('run_sql — visibility across roles', () => {
  it('cold-start writes via typed tool, diary reads via run_sql', async () => {
    const cs = build('cold-start');
    await cs.callTool('create_play', {
      name: 'investor-weekly-update',
      title: 'How Avery handles the Friday investor update',
      content: 'Short, numbers-first. Signs as avery.',
      derived_from: ['gmail:1'],
    });

    const diary = build('diary');
    const res = (await diary.callTool('run_sql', {
      sql: 'SELECT name, title FROM plays WHERE name = ?',
      params: ['investor-weekly-update'],
    })) as { rows: { name: string; title: string }[] };
    expect(res.rows[0]).toMatchObject({ name: 'investor-weekly-update' });
  });
});

describe('run_sql — error surfaces cleanly', () => {
  it('unknown table throws', async () => {
    const mind = build('mind');
    await expect(
      mind.callTool('run_sql', { sql: 'SELECT * FROM no_such_table' }),
    ).rejects.toThrow();
  });
});
