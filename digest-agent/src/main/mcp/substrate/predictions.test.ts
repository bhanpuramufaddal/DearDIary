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
  tmp = mkdtempSync(join(tmpdir(), 'digest-preds-test-'));
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

async function seedAnchor(server: SubstrateServer): Promise<void> {
  await server.callTool('create_anchor', { display_name: 'Marcus Webb' });
  await server.callTool('update_anchor_layer', {
    id: 'marcus_webb',
    layer: 'slow',
    content: 'investor',
    precision: 0.7,
    source_ids: ['gmail:1'],
  });
}

describe('create_prediction', () => {
  it('creates an event prediction with expected_by + bindings atomically', async () => {
    const server = build();
    await seedAnchor(server);

    const res = (await server.callTool('create_prediction', {
      anchor_id: 'marcus_webb',
      kind: 'event',
      claim: 'term sheet signs Friday',
      expected_by: '2026-05-29T17:00:00-07:00',
      precision: 0.7,
      based_on: ['slow', 'mid'],
    })) as { id: string };
    expect(res.id).toMatch(/^pred_/);

    const pred = (await server.callTool('run_sql', {
      sql: 'SELECT kind, claim, expected_by, precision FROM predictions WHERE id = ?',
      params: [res.id],
    })) as { rows: Record<string, unknown>[] };
    expect(pred.rows[0]).toMatchObject({
      kind: 'event',
      claim: 'term sheet signs Friday',
      expected_by: '2026-05-29T17:00:00-07:00',
      precision: 0.7,
    });

    const bindings = (await server.callTool('run_sql', {
      sql: 'SELECT layer FROM prediction_layer_bindings WHERE prediction_id = ? ORDER BY layer',
      params: [res.id],
    })) as { rows: { layer: string }[] };
    expect(bindings.rows.map((r) => r.layer).sort()).toEqual(['mid', 'slow']);
  });

  it("rejects kind='event' without expected_by (pre-SQL check)", async () => {
    const server = build();
    await seedAnchor(server);
    await expect(
      server.callTool('create_prediction', {
        anchor_id: 'marcus_webb',
        kind: 'event',
        claim: 'x',
        precision: 0.5,
        based_on: ['slow'],
      }),
    ).rejects.toThrow(/expected_by is required iff kind='event'/);
  });

  it("rejects kind='fact' WITH expected_by", async () => {
    const server = build();
    await seedAnchor(server);
    await expect(
      server.callTool('create_prediction', {
        anchor_id: 'marcus_webb',
        kind: 'fact',
        claim: 'x',
        expected_by: '2026-05-29T17:00:00-07:00',
        precision: 0.5,
        based_on: ['slow'],
      }),
    ).rejects.toThrow();
  });

  it('rejects missing anchor', async () => {
    const server = build();
    await expect(
      server.callTool('create_prediction', {
        anchor_id: 'nobody',
        kind: 'fact',
        claim: 'x',
        precision: 0.5,
        based_on: ['slow'],
      }),
    ).rejects.toThrow(/anchor not found: nobody/);
  });
});

describe('delete_prediction', () => {
  it('cascades to layer bindings', async () => {
    const server = build();
    await seedAnchor(server);
    const { id } = (await server.callTool('create_prediction', {
      anchor_id: 'marcus_webb',
      kind: 'pattern',
      claim: 'replies in ~24h',
      precision: 0.65,
      based_on: ['slow'],
    })) as { id: string };

    await server.callTool('delete_prediction', { id });

    const bindings = (await server.callTool('run_sql', {
      sql: 'SELECT COUNT(*) AS n FROM prediction_layer_bindings WHERE prediction_id = ?',
      params: [id],
    })) as { rows: { n: number }[] };
    expect(bindings.rows[0]!.n).toBe(0);
  });
});

describe('interplay with support_prediction_precision', () => {
  it('returns the id reusable by the nudge tools', async () => {
    const server = build();
    await seedAnchor(server);
    const { id } = (await server.callTool('create_prediction', {
      anchor_id: 'marcus_webb',
      kind: 'pattern',
      claim: 'replies in ~24h',
      precision: 0.6,
      based_on: ['slow'],
    })) as { id: string };

    const nudged = (await server.callTool('support_prediction_precision', {
      id,
    })) as { new_precision: number };
    expect(nudged.new_precision).toBeCloseTo(0.64);
  });
});
