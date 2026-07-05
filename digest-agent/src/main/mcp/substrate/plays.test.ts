import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createSubstrateServer, type SubstrateServer } from './server.js';

const T0 = '2026-05-25T12:00:00-07:00';

let tmp: string;
let dbPath: string;
let digestDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-plays-test-'));
  digestDir = tmp;
  dbPath = join(tmp, 'digest.db');
  mkdirSync(join(tmp, 'plays'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function build(role: 'mind' | 'cold-start' | 'diary' = 'cold-start'): SubstrateServer {
  return createSubstrateServer({ role, dbPath, digestDir, now: () => T0 });
}

describe('create_play', () => {
  it('inserts a persona play with derived_from sources', async () => {
    const server = build();
    const res = (await server.callTool('create_play', {
      name: 'investor-weekly-update',
      title: 'How Avery handles the investor weekly update',
      content: '# Pattern\n\nFriday mornings, sent before 9am PT...',
      derived_from: ['gmail:1', 'gmail:2', 'gmail:3'],
    })) as { name: string };
    expect(res.name).toBe('investor-weekly-update');

    const row = (await server.callTool('run_sql', {
      sql: 'SELECT title, content, derived_from FROM plays WHERE name = ?',
      params: ['investor-weekly-update'],
    })) as { rows: Record<string, unknown>[] };
    expect(row.rows[0]).toMatchObject({
      title: 'How Avery handles the investor weekly update',
    });
    expect(JSON.parse(row.rows[0]!['derived_from'] as string)).toEqual([
      'gmail:1',
      'gmail:2',
      'gmail:3',
    ]);
  });

  it('upserts on re-run (refreshes title + content)', async () => {
    const server = build();
    await server.callTool('create_play', {
      name: 'x',
      title: 'v1',
      content: 'v1 body',
      derived_from: ['gmail:1'],
    });
    await server.callTool('create_play', {
      name: 'x',
      title: 'v2',
      content: 'v2 body',
      derived_from: ['gmail:2'],
    });

    const row = (await server.callTool('run_sql', {
      sql: 'SELECT title, content FROM plays WHERE name = ?',
      params: ['x'],
    })) as { rows: { title: string; content: string }[] };
    expect(row.rows[0]).toMatchObject({ title: 'v2', content: 'v2 body' });
  });

  it("rejects reserved name prefixes (howto:, reasoning:, triage:)", async () => {
    const server = build();
    for (const reserved of ['howto:foo', 'reasoning:bar', 'triage:baz']) {
      await expect(
        server.callTool('create_play', { name: reserved, title: 'x', content: 'y' }),
      ).rejects.toThrow(/reserved prefix/);
    }
  });

  it('diary role does NOT get create_play', () => {
    const diary = new Set(build('diary').listTools());
    expect(diary.has('create_play')).toBe(false);
  });
});
