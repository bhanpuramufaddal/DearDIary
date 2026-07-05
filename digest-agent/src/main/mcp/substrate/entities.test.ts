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
  tmp = mkdtempSync(join(tmpdir(), 'digest-entities-test-'));
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

async function readEntity(server: SubstrateServer, id: string) {
  const res = (await server.callTool('run_sql', {
    sql: 'SELECT e.*, n.kind AS node_kind FROM entities e JOIN nodes n ON n.id=e.id WHERE e.id = ?',
    params: [id],
  })) as { rows: Record<string, unknown>[] };
  return res.rows[0];
}

describe('create_entity', () => {
  it('slugifies display_name and seeds mention_count=1', async () => {
    const server = build();
    const res = (await server.callTool('create_entity', {
      display_name: 'Acme Corp',
      kind_hint: 'company',
      identity_handles: ['acme.com'],
    })) as { id: string };
    expect(res.id).toBe('acme_corp');

    const row = await readEntity(server, 'acme_corp');
    expect(row).toMatchObject({
      id: 'acme_corp',
      node_kind: 'entity',
      kind_hint: 'company',
      mention_count: 1,
      first_seen: T0,
      last_seen: T0,
    });
    expect(JSON.parse(row!['identity_handles'] as string)).toEqual(['acme.com']);
  });

  it('rejects collision', async () => {
    const server = build();
    await server.callTool('create_entity', { display_name: 'Acme' });
    await expect(
      server.callTool('create_entity', { display_name: 'Acme' }),
    ).rejects.toThrow(/id collision: "acme"/);
  });
});

describe('bump_entity', () => {
  it('increments mention_count and updates last_seen', async () => {
    const server = build();
    await server.callTool('create_entity', { display_name: 'Acme' });

    const res = (await server.callTool('bump_entity', { id: 'acme' })) as {
      mention_count: number;
      last_seen: string;
    };
    expect(res.mention_count).toBe(2);
    expect(res.last_seen).toBe(T0);

    // bump again
    const r2 = (await server.callTool('bump_entity', { id: 'acme' })) as {
      mention_count: number;
    };
    expect(r2.mention_count).toBe(3);
  });

  it('throws on missing entity', async () => {
    const server = build();
    await expect(server.callTool('bump_entity', { id: 'nobody' })).rejects.toThrow(
      /entity not found: nobody/,
    );
  });
});

describe('update_entity', () => {
  it('updates kind_hint and notes selectively', async () => {
    const server = build();
    await server.callTool('create_entity', { display_name: 'Acme', kind_hint: 'company' });
    await server.callTool('update_entity', {
      id: 'acme',
      notes: 'a customer account, talks to Marcus',
    });
    const row = await readEntity(server, 'acme');
    expect(row).toMatchObject({
      kind_hint: 'company', // unchanged
      notes: 'a customer account, talks to Marcus',
    });
  });

  it('rejects when no fields provided', async () => {
    const server = build();
    await server.callTool('create_entity', { display_name: 'a' });
    await expect(server.callTool('update_entity', { id: 'a' })).rejects.toThrow();
  });
});

describe('delete_entity', () => {
  it('cascades via nodes', async () => {
    const server = build();
    await server.callTool('create_entity', { display_name: 'Acme' });
    await server.callTool('delete_entity', { id: 'acme' });
    expect(await readEntity(server, 'acme')).toBeUndefined();
    const nodeRow = (await server.callTool('run_sql', {
      sql: "SELECT * FROM nodes WHERE id='acme'",
    })) as { rows: unknown[] };
    expect(nodeRow.rows).toHaveLength(0);
  });
});

describe('update_identity_handles', () => {
  it('adds handles on an entity, dedupes against existing', async () => {
    const server = build();
    await server.callTool('create_entity', {
      display_name: 'Marcus',
      identity_handles: ['marcus@old.com'],
    });
    const res = (await server.callTool('update_identity_handles', {
      node_id: 'marcus',
      add: ['marcus@new.com', 'marcus@old.com'],
    })) as { handles: string[] };
    expect(res.handles.sort()).toEqual(['marcus@new.com', 'marcus@old.com']);
  });

  it('removes handles on an anchor', async () => {
    const server = build();
    await server.callTool('create_anchor', {
      display_name: 'Marcus Webb',
      identity_handles: ['m@old.com', 'm@new.com'],
    });
    const res = (await server.callTool('update_identity_handles', {
      node_id: 'marcus_webb',
      remove: ['m@old.com'],
    })) as { handles: string[] };
    expect(res.handles).toEqual(['m@new.com']);
  });

  it('combines add + remove atomically', async () => {
    const server = build();
    await server.callTool('create_anchor', {
      display_name: 'M',
      identity_handles: ['a', 'b'],
    });
    const res = (await server.callTool('update_identity_handles', {
      node_id: 'm',
      add: ['c'],
      remove: ['a'],
    })) as { handles: string[] };
    expect(res.handles.sort()).toEqual(['b', 'c']);
  });

  it('rejects when both add and remove are empty', async () => {
    const server = build();
    await server.callTool('create_entity', { display_name: 'a' });
    await expect(
      server.callTool('update_identity_handles', { node_id: 'a' }),
    ).rejects.toThrow();
  });

  it('throws on missing node', async () => {
    const server = build();
    await expect(
      server.callTool('update_identity_handles', { node_id: 'nobody', add: ['x'] }),
    ).rejects.toThrow(/node not found/);
  });
});

describe('cite', () => {
  it('adds a case_base entry to an anchor layer', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'M' });
    await server.callTool('update_anchor_layer', {
      id: 'm',
      layer: 'slow',
      content: 'a claim',
      precision: 0.6,
      source_ids: ['gmail:1'],
    });

    const res = (await server.callTool('cite', {
      node_id: 'm',
      layer: 'slow',
      source_id: 'gmail:2',
      date: '2026-05-22',
      note: 'corroborating message',
    })) as { id: string };
    expect(res.id).toMatch(/^cb_/);

    const cites = (await server.callTool('run_sql', {
      sql: "SELECT source_id, note FROM case_base_entries WHERE node_id='m' AND layer='slow' ORDER BY position",
    })) as { rows: { source_id: string; note: string | null }[] };
    expect(cites.rows.map((r) => r.source_id)).toEqual(['gmail:1', 'gmail:2']);
  });

  it('adds a flat case_base entry to an entity (no layer)', async () => {
    const server = build();
    await server.callTool('create_entity', { display_name: 'acme' });
    await server.callTool('cite', {
      node_id: 'acme',
      source_id: 'gmail:42',
    });

    const cites = (await server.callTool('run_sql', {
      sql: "SELECT source_id, layer FROM case_base_entries WHERE node_id='acme'",
    })) as { rows: { source_id: string; layer: string | null }[] };
    expect(cites.rows).toHaveLength(1);
    expect(cites.rows[0]!.layer).toBeNull();
  });

  it('rejects layer when target is an entity', async () => {
    const server = build();
    await server.callTool('create_entity', { display_name: 'acme' });
    await expect(
      server.callTool('cite', { node_id: 'acme', layer: 'slow', source_id: 'gmail:1' }),
    ).rejects.toThrow(/entity case_base entries do not carry a layer/);
  });
});
