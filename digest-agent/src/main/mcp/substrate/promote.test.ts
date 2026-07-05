import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createSubstrateServer, type SubstrateServer } from './server.js';

const T0 = '2026-05-25T12:00:00-07:00';

let tmp: string;
let dbPath: string;
let digestDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-promote-test-'));
  digestDir = tmp;
  dbPath = join(tmp, 'digest.db');
  mkdirSync(join(tmp, 'plays'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function build(): SubstrateServer {
  return createSubstrateServer({ role: 'mind', dbPath, digestDir, now: () => T0 });
}

describe('promote_entity — happy path', () => {
  it('flips node.kind, drops entities row, creates anchor with slow layer, re-layers + adds case_base', async () => {
    const server = build();

    // Seed an entity with two prior flat case_base citations (layer NULL).
    await server.callTool('create_entity', {
      display_name: 'Marcus Webb',
      kind_hint: 'person',
      identity_handles: ['marcus@inflection.vc'],
      notes: 'spotted across 4 messages',
    });
    await server.callTool('cite', { node_id: 'marcus_webb', source_id: 'gmail:1' });
    await server.callTool('cite', { node_id: 'marcus_webb', source_id: 'gmail:2' });

    const res = (await server.callTool('promote_entity', {
      id: 'marcus_webb',
      kind: 'investor',
      slow_content: 'Series A lead at Inflection Point — observed across 6 emails.',
      slow_precision: 0.6,
      source_ids: ['gmail:3', 'gmail:4'],
      date: '2026-05-25',
    })) as { anchor_id: string; cites_re_layered: number; cites_added: number };

    expect(res).toMatchObject({
      anchor_id: 'marcus_webb',
      cites_re_layered: 2,
      cites_added: 2,
    });

    // nodes.kind flipped
    const node = (await server.callTool('run_sql', {
      sql: "SELECT kind FROM nodes WHERE id = 'marcus_webb'",
    })) as { rows: { kind: string }[] };
    expect(node.rows[0]!.kind).toBe('anchor');

    // entities row gone
    const ent = (await server.callTool('run_sql', {
      sql: "SELECT COUNT(*) AS n FROM entities WHERE id = 'marcus_webb'",
    })) as { rows: { n: number }[] };
    expect(ent.rows[0]!.n).toBe(0);

    // anchors row exists with the right slow layer + carried-over identity_handles + notes
    const anc = (await server.callTool('run_sql', {
      sql: "SELECT kind, slow_content, slow_precision, notes, identity_handles FROM anchors WHERE id = 'marcus_webb'",
    })) as { rows: Record<string, unknown>[] };
    expect(anc.rows[0]).toMatchObject({
      kind: 'investor',
      slow_content: 'Series A lead at Inflection Point — observed across 6 emails.',
      slow_precision: 0.6,
      notes: 'spotted across 4 messages',
    });
    expect(JSON.parse(anc.rows[0]!['identity_handles'] as string)).toEqual([
      'marcus@inflection.vc',
    ]);

    // 4 case_base rows on the slow layer (2 re-layered + 2 added)
    const cb = (await server.callTool('run_sql', {
      sql: "SELECT source_id FROM case_base_entries WHERE node_id='marcus_webb' AND layer='slow' ORDER BY source_id",
    })) as { rows: { source_id: string }[] };
    expect(cb.rows.map((r) => r.source_id)).toEqual(['gmail:1', 'gmail:2', 'gmail:3', 'gmail:4']);

    // no rows still on layer NULL
    const stillNull = (await server.callTool('run_sql', {
      sql: "SELECT COUNT(*) AS n FROM case_base_entries WHERE node_id='marcus_webb' AND layer IS NULL",
    })) as { rows: { n: number }[] };
    expect(stillNull.rows[0]!.n).toBe(0);
  });

  it('lets a fresh reminder reference the promoted anchor', async () => {
    // After promotion the new anchor is a valid reminder target — verifying
    // that the id survives the kind flip (nothing else changed in nodes).
    const server = build();
    await server.callTool('create_entity', { display_name: 'Marcus Webb' });
    await server.callTool('promote_entity', {
      id: 'marcus_webb',
      slow_content: 'Newly anchored.',
      slow_precision: 0.55,
      source_ids: ['gmail:1'],
    });
    const { id: remId } = (await server.callTool('set_reminder', {
      fires_at: '2026-05-29T09:00:00-07:00',
      context: 'follow up after promotion',
      anchor_ids: ['marcus_webb'],
    })) as { id: string };
    const refs = (await server.callTool('run_sql', {
      sql: 'SELECT COUNT(*) AS n FROM reminder_anchor_refs WHERE reminder_id = ?',
      params: [remId],
    })) as { rows: { n: number }[] };
    expect(refs.rows[0]!.n).toBe(1);
  });
});

describe('promote_entity — rejections', () => {
  it('rejects when the id is not an entity', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'Already' });
    await expect(
      server.callTool('promote_entity', {
        id: 'already',
        slow_content: 'x',
        slow_precision: 0.5,
        source_ids: ['gmail:1'],
      }),
    ).rejects.toThrow(/not an entity: already is a anchor/);
  });

  it('rejects empty source_ids', async () => {
    const server = build();
    await server.callTool('create_entity', { display_name: 'x' });
    await expect(
      server.callTool('promote_entity', {
        id: 'x',
        slow_content: 'y',
        slow_precision: 0.5,
        source_ids: [],
      }),
    ).rejects.toThrow(/source_ids must include at least one citation/);
  });

  it('rolls back fully on a mid-step failure (transaction integrity)', async () => {
    // Force a PK collision on the inner INSERT INTO anchors step. Run_sql is
    // read-only at the MCP boundary now, so we use a direct better-sqlite3
    // handle on the same DB file to inject the conflicting row.
    const server = build();
    await server.callTool('create_entity', { display_name: 'collision' });

    const rawDb = new Database(dbPath);
    rawDb.pragma('foreign_keys = ON');
    rawDb
      .prepare(
        'INSERT INTO anchors (id, kind, last_bumped, identity_handles) VALUES (?, ?, ?, ?)',
      )
      .run('collision', 'subject', T0, '[]');
    rawDb.close();

    await expect(
      server.callTool('promote_entity', {
        id: 'collision',
        slow_content: 'x',
        slow_precision: 0.5,
        source_ids: ['gmail:1'],
      }),
    ).rejects.toThrow();

    // Entity row should still be present (transaction rolled back).
    const ent = (await server.callTool('run_sql', {
      sql: "SELECT COUNT(*) AS n FROM entities WHERE id = 'collision'",
    })) as { rows: { n: number }[] };
    expect(ent.rows[0]!.n).toBe(1);

    // Node kind should still be 'entity' (the flip rolled back).
    const node = (await server.callTool('run_sql', {
      sql: "SELECT kind FROM nodes WHERE id = 'collision'",
    })) as { rows: { kind: string }[] };
    expect(node.rows[0]!.kind).toBe('entity');
  });
});
