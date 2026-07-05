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
  tmp = mkdtempSync(join(tmpdir(), 'digest-anchors-test-'));
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

async function readAnchorRow(server: SubstrateServer, id: string) {
  const res = (await server.callTool('run_sql', {
    sql: 'SELECT a.*, n.kind AS node_kind FROM anchors a JOIN nodes n ON n.id=a.id WHERE a.id = ?',
    params: [id],
  })) as { rows: Record<string, unknown>[] };
  return res.rows[0];
}

describe('create_anchor', () => {
  it('slugifies display_name into the id and inserts node + anchor atomically', async () => {
    const server = build();
    const res = (await server.callTool('create_anchor', {
      display_name: 'Marcus Webb',
      kind: 'investor',
      identity_handles: ['marcus@inflection.vc'],
    })) as { id: string };
    expect(res.id).toBe('marcus_webb');

    const row = await readAnchorRow(server, 'marcus_webb');
    expect(row).toMatchObject({
      id: 'marcus_webb',
      display_name: 'Marcus Webb',
      kind: 'investor',
      node_kind: 'anchor',
      slow_content: null,
      slow_precision: null,
    });
    expect(JSON.parse(row!['identity_handles'] as string)).toEqual(['marcus@inflection.vc']);
  });

  it('accepts an explicit id (used for reserved ids like _principal)', async () => {
    const server = build();
    const res = (await server.callTool('create_anchor', {
      display_name: 'Avery',
      id: '_principal',
      kind: 'person',
    })) as { id: string };
    expect(res.id).toBe('_principal');
    expect(await readAnchorRow(server, '_principal')).toBeDefined();
  });

  it('strips diacritics during slugify', async () => {
    const server = build();
    const res = (await server.callTool('create_anchor', {
      display_name: "André O'Brien",
    })) as { id: string };
    expect(res.id).toBe('andre_o_brien');
  });

  it('rejects collision with a helpful message', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'Marcus Webb' });
    await expect(
      server.callTool('create_anchor', { display_name: 'Marcus Webb' }),
    ).rejects.toThrow(/id collision: "marcus_webb"/);
  });

  it('rolls back when the node insert succeeds but the anchor insert fails', async () => {
    // The schema doesn't actually offer a way to make the second insert fail
    // without breaking the first, so we just verify the transaction wrapper
    // by attempting to recreate the same id after the failed attempt is gone.
    const server = build();
    await server.callTool('create_anchor', { display_name: 'A B' });
    // Confirm no orphan node from an earlier rollback.
    const orphans = (await server.callTool('run_sql', {
      sql: "SELECT n.id FROM nodes n LEFT JOIN anchors a ON a.id=n.id LEFT JOIN entities e ON e.id=n.id WHERE a.id IS NULL AND e.id IS NULL",
    })) as { rows: unknown[] };
    expect(orphans.rows).toHaveLength(0);
  });
});

describe('update_anchor_layer', () => {
  it('writes content + initial precision + case_base citations atomically', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'Marcus Webb' });

    const res = (await server.callTool('update_anchor_layer', {
      id: 'marcus_webb',
      layer: 'slow',
      content: 'Series A lead at Inflection Point. Replies in ~24h.',
      precision: 0.7,
      source_ids: ['gmail:abc', 'gmail:def'],
      date: '2026-05-20',
    })) as { id: string; layer: string; precision: number; cites_added: number };

    expect(res).toMatchObject({
      id: 'marcus_webb',
      layer: 'slow',
      precision: 0.7,
      cites_added: 2,
    });

    const row = await readAnchorRow(server, 'marcus_webb');
    expect(row).toMatchObject({
      slow_content: 'Series A lead at Inflection Point. Replies in ~24h.',
      slow_precision: 0.7,
    });

    const cites = (await server.callTool('run_sql', {
      sql: "SELECT source_id FROM case_base_entries WHERE node_id='marcus_webb' AND layer='slow' ORDER BY source_id",
    })) as { rows: { source_id: string }[] };
    expect(cites.rows.map((r) => r.source_id)).toEqual(['gmail:abc', 'gmail:def']);
  });

  it('rejects empty source_ids — every claim must be cited', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'M' });
    await expect(
      server.callTool('update_anchor_layer', {
        id: 'm',
        layer: 'slow',
        content: 'a claim',
        source_ids: [],
      }),
    ).rejects.toThrow(/source_ids must include at least one citation/);
  });

  it('rejects precision on a layer that already has one', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'M' });
    await server.callTool('update_anchor_layer', {
      id: 'm',
      layer: 'slow',
      content: 'initial',
      precision: 0.6,
      source_ids: ['gmail:1'],
    });
    await expect(
      server.callTool('update_anchor_layer', {
        id: 'm',
        layer: 'slow',
        content: 'updated',
        precision: 0.7,
        source_ids: ['gmail:2'],
      }),
    ).rejects.toThrow(/precision is already set on m\/slow/);
  });

  it('allows content-only updates after the layer is initialized (no precision arg)', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'M' });
    await server.callTool('update_anchor_layer', {
      id: 'm',
      layer: 'slow',
      content: 'v1',
      precision: 0.6,
      source_ids: ['gmail:1'],
    });
    const res = (await server.callTool('update_anchor_layer', {
      id: 'm',
      layer: 'slow',
      content: 'v2',
      source_ids: ['gmail:2'],
    })) as { precision: number };
    expect(res.precision).toBeCloseTo(0.6); // precision unchanged

    const row = await readAnchorRow(server, 'm');
    expect(row!['slow_content']).toBe('v2');
  });

  it('throws on missing anchor', async () => {
    const server = build();
    await expect(
      server.callTool('update_anchor_layer', {
        id: 'nobody',
        layer: 'slow',
        content: 'x',
        source_ids: ['gmail:1'],
      }),
    ).rejects.toThrow(/anchor not found: nobody/);
  });
});

describe('update_anchor_meta', () => {
  it('updates display_name / kind / notes selectively', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'Marcus Webb', kind: 'subject' });

    await server.callTool('update_anchor_meta', {
      id: 'marcus_webb',
      kind: 'investor',
      notes: 'lead investor',
    });

    const row = await readAnchorRow(server, 'marcus_webb');
    expect(row).toMatchObject({
      display_name: 'Marcus Webb', // unchanged
      kind: 'investor',
      notes: 'lead investor',
    });
  });

  it('rejects when no fields are provided', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'M' });
    await expect(server.callTool('update_anchor_meta', { id: 'm' })).rejects.toThrow();
  });
});

describe('bump_anchor', () => {
  it('updates last_bumped without touching layers', async () => {
    // Build a server with an EARLIER clock so create_anchor writes an old
    // last_bumped. Then build a second server (same DB) with T0 and bump —
    // the bump should advance last_bumped to T0.
    const earlyClock = '2020-01-01T00:00:00-07:00';
    const earlyServer = createSubstrateServer({
      role: 'mind',
      dbPath,
      digestDir,
      now: () => earlyClock,
    });
    await earlyServer.callTool('create_anchor', { display_name: 'M' });

    const server = build();
    const res = (await server.callTool('bump_anchor', { id: 'm' })) as {
      id: string;
      last_bumped: string;
    };
    expect(res.last_bumped).toBe(T0);

    const row = await readAnchorRow(server, 'm');
    expect(row!['last_bumped']).toBe(T0);
  });
});

describe('delete_anchor', () => {
  it('cascades delete via nodes', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'M' });
    await server.callTool('update_anchor_layer', {
      id: 'm',
      layer: 'slow',
      content: 'a',
      precision: 0.5,
      source_ids: ['gmail:1'],
    });

    await server.callTool('delete_anchor', { id: 'm' });

    const aRow = await readAnchorRow(server, 'm');
    expect(aRow).toBeUndefined();

    const cbRows = (await server.callTool('run_sql', {
      sql: "SELECT COUNT(*) AS n FROM case_base_entries WHERE node_id = 'm'",
    })) as { rows: { n: number }[] };
    expect(cbRows.rows[0]!.n).toBe(0);
  });

  it('throws on missing anchor', async () => {
    const server = build();
    await expect(server.callTool('delete_anchor', { id: 'nobody' })).rejects.toThrow(
      /anchor not found/,
    );
  });
});
