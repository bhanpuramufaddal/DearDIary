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
  tmp = mkdtempSync(join(tmpdir(), 'digest-rels-test-'));
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

async function seedTwoAnchors(server: SubstrateServer): Promise<void> {
  await server.callTool('create_anchor', { display_name: 'Avery', id: '_principal' });
  await server.callTool('create_anchor', { display_name: 'Marcus Webb' });
}

describe('create_relationship', () => {
  it('creates an edge with a server-generated rel_ id', async () => {
    const server = build();
    await seedTwoAnchors(server);
    const res = (await server.callTool('create_relationship', {
      subject_id: '_principal',
      target_id: 'marcus_webb',
    })) as { id: string };
    expect(res.id).toMatch(/^rel_/);

    const rows = (await server.callTool('run_sql', {
      sql: "SELECT subject_id, target_id FROM relationships WHERE id = ?",
      params: [res.id],
    })) as { rows: { subject_id: string; target_id: string }[] };
    expect(rows.rows[0]).toEqual({ subject_id: '_principal', target_id: 'marcus_webb' });
  });

  it('rejects target that is an entity (clearer error than the trigger)', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'Avery', id: '_principal' });
    await server.callTool('create_entity', { display_name: 'Acme' });
    await expect(
      server.callTool('create_relationship', { subject_id: '_principal', target_id: 'acme' }),
    ).rejects.toThrow(/target must be an anchor: acme is a entity/);
  });

  it('rejects missing subject or target', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'M' });
    await expect(
      server.callTool('create_relationship', { subject_id: 'nobody', target_id: 'm' }),
    ).rejects.toThrow(/subject node not found/);
    await expect(
      server.callTool('create_relationship', { subject_id: 'm', target_id: 'nobody' }),
    ).rejects.toThrow(/target node not found/);
  });
});

describe('update_relationship_layer', () => {
  it('writes claim + initial precision on first call', async () => {
    const server = build();
    await seedTwoAnchors(server);
    const { id } = (await server.callTool('create_relationship', {
      subject_id: '_principal',
      target_id: 'marcus_webb',
    })) as { id: string };

    const res = (await server.callTool('update_relationship_layer', {
      id,
      layer: 'slow',
      claim: 'Series A lead investor',
      precision: 0.65,
    })) as { precision: number };
    expect(res.precision).toBeCloseTo(0.65);
  });

  it('rejects precision on a layer that already has one', async () => {
    const server = build();
    await seedTwoAnchors(server);
    const { id } = (await server.callTool('create_relationship', {
      subject_id: '_principal',
      target_id: 'marcus_webb',
    })) as { id: string };
    await server.callTool('update_relationship_layer', {
      id,
      layer: 'mid',
      claim: 'v1',
      precision: 0.5,
    });
    await expect(
      server.callTool('update_relationship_layer', {
        id,
        layer: 'mid',
        claim: 'v2',
        precision: 0.6,
      }),
    ).rejects.toThrow(/precision is already set/);
  });

  it('allows claim-only updates after initialization', async () => {
    const server = build();
    await seedTwoAnchors(server);
    const { id } = (await server.callTool('create_relationship', {
      subject_id: '_principal',
      target_id: 'marcus_webb',
    })) as { id: string };
    await server.callTool('update_relationship_layer', {
      id,
      layer: 'fast',
      claim: 'v1',
      precision: 0.5,
    });
    await server.callTool('update_relationship_layer', { id, layer: 'fast', claim: 'v2' });
    const rows = (await server.callTool('run_sql', {
      sql: 'SELECT fast_claim FROM relationships WHERE id = ?',
      params: [id],
    })) as { rows: { fast_claim: string }[] };
    expect(rows.rows[0]!.fast_claim).toBe('v2');
  });
});

describe('delete_relationship', () => {
  it('removes the row', async () => {
    const server = build();
    await seedTwoAnchors(server);
    const { id } = (await server.callTool('create_relationship', {
      subject_id: '_principal',
      target_id: 'marcus_webb',
    })) as { id: string };
    await server.callTool('delete_relationship', { id });
    const rows = (await server.callTool('run_sql', {
      sql: 'SELECT COUNT(*) AS n FROM relationships WHERE id = ?',
      params: [id],
    })) as { rows: { n: number }[] };
    expect(rows.rows[0]!.n).toBe(0);
  });
});
