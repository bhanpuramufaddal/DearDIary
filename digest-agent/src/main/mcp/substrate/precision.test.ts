import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createSubstrateServer, type SubstrateServer } from './server.js';
import { applyNudge } from './tools/precision.js';

const T0 = '2026-05-25T12:00:00-07:00';

let tmp: string;
let dbPath: string;
let digestDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-precision-test-'));
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

async function seedAnchor(
  server: SubstrateServer,
  id: string,
  precisions: { slow?: number | null; mid?: number | null; fast?: number | null } = {},
): Promise<void> {
  const displayName =
    id
      .replace(/^_/, '')
      .split('_')
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(' ') || id;
  if (id === '_principal') {
    await server.callTool('create_anchor', { display_name: displayName, id, kind: 'person' });
  } else {
    await server.callTool('create_anchor', { display_name: displayName, kind: 'person' });
  }
  for (const layer of ['slow', 'mid', 'fast'] as const) {
    const p = precisions[layer];
    if (p == null) continue;
    await server.callTool('update_anchor_layer', {
      id,
      layer,
      content: `${layer} content`,
      precision: p,
      source_ids: ['seed:1'],
    });
  }
}

async function seedPrediction(
  server: SubstrateServer,
  anchorId: string,
  precision: number,
): Promise<string> {
  const res = (await server.callTool('create_prediction', {
    anchor_id: anchorId,
    kind: 'fact',
    claim: 'a claim',
    precision,
    based_on: ['slow'],
  })) as { id: string };
  return res.id;
}

async function seedRelationship(
  server: SubstrateServer,
  subjectId: string,
  targetId: string,
  precisions: { slow?: number | null; mid?: number | null; fast?: number | null } = {},
): Promise<string> {
  const res = (await server.callTool('create_relationship', {
    subject_id: subjectId,
    target_id: targetId,
  })) as { id: string };
  for (const layer of ['slow', 'mid', 'fast'] as const) {
    const p = precisions[layer];
    if (p == null) continue;
    await server.callTool('update_relationship_layer', {
      id: res.id,
      layer,
      claim: `${layer} claim`,
      precision: p,
    });
  }
  return res.id;
}

async function selectPrecision(
  server: SubstrateServer,
  sql: string,
  params: unknown[] = [],
): Promise<number | null> {
  const res = (await server.callTool('run_sql', { sql, params })) as {
    rows: { p: number | null }[];
  };
  return res.rows[0]?.p ?? null;
}

describe('applyNudge — pure math', () => {
  it('support: 0.6 → 0.64', () => {
    expect(applyNudge(0.6, 'support')).toBeCloseTo(0.64);
  });

  it('contradict: 0.6 → 0.42', () => {
    expect(applyNudge(0.6, 'contradict')).toBeCloseTo(0.42);
  });

  it('support: 0.5 → 0.55', () => {
    expect(applyNudge(0.5, 'support')).toBeCloseTo(0.55);
  });

  it('contradict: 0.5 → 0.35', () => {
    expect(applyNudge(0.5, 'contradict')).toBeCloseTo(0.35);
  });

  it('clamps support to ceiling 0.95', () => {
    expect(applyNudge(0.95, 'support')).toBeCloseTo(0.95);
    expect(applyNudge(0.99, 'support')).toBeCloseTo(0.95);
  });

  it('clamps contradict to floor 0.05', () => {
    expect(applyNudge(0.07, 'contradict')).toBeCloseTo(0.05);
    expect(applyNudge(0.05, 'contradict')).toBeCloseTo(0.05);
  });

  it('mid-range values pass through cleanly', () => {
    expect(applyNudge(0.94, 'support')).toBeCloseTo(0.946);
  });
});

describe('prediction nudges', () => {
  it('support_prediction_precision updates predictions.precision via applyNudge', async () => {
    const server = build();
    await seedAnchor(server, 'marcus_webb', { slow: 0.7 });
    const predId = await seedPrediction(server, 'marcus_webb', 0.6);

    const res = (await server.callTool('support_prediction_precision', {
      id: predId,
    })) as {
      target: string;
      id: string;
      direction: string;
      old_precision: number;
      new_precision: number;
      layer?: string;
    };

    expect(res).toMatchObject({
      target: 'prediction',
      id: predId,
      direction: 'support',
      old_precision: 0.6,
    });
    expect(res.new_precision).toBeCloseTo(0.64);
    expect(res.layer).toBeUndefined();

    const stored = await selectPrecision(
      server,
      'SELECT precision AS p FROM predictions WHERE id = ?',
      [predId],
    );
    expect(stored).toBeCloseTo(0.64);
  });

  it('contradict_prediction_precision lowers a prediction by the formula', async () => {
    const server = build();
    await seedAnchor(server, 'marcus_webb', { slow: 0.7 });
    const predId = await seedPrediction(server, 'marcus_webb', 0.6);

    await server.callTool('contradict_prediction_precision', { id: predId });
    const stored = await selectPrecision(
      server,
      'SELECT precision AS p FROM predictions WHERE id = ?',
      [predId],
    );
    expect(stored).toBeCloseTo(0.42);
  });

  it('throws when the prediction does not exist', async () => {
    const server = build();
    await expect(
      server.callTool('support_prediction_precision', { id: 'missing' }),
    ).rejects.toThrow(/prediction not found: missing/);
  });
});

describe('anchor layer nudges', () => {
  it('contradicts the slow layer; mid/fast untouched', async () => {
    const server = build();
    await seedAnchor(server, 'marcus_webb', { slow: 0.5, mid: 0.7, fast: 0.4 });

    const res = (await server.callTool('contradict_anchor_precision', {
      id: 'marcus_webb',
      layer: 'slow',
    })) as { layer?: string; old_precision: number; new_precision: number };
    expect(res.layer).toBe('slow');
    expect(res.old_precision).toBeCloseTo(0.5);
    expect(res.new_precision).toBeCloseTo(0.35);

    const slow = await selectPrecision(
      server,
      'SELECT slow_precision AS p FROM anchors WHERE id = ?',
      ['marcus_webb'],
    );
    const mid = await selectPrecision(
      server,
      'SELECT mid_precision AS p FROM anchors WHERE id = ?',
      ['marcus_webb'],
    );
    const fast = await selectPrecision(
      server,
      'SELECT fast_precision AS p FROM anchors WHERE id = ?',
      ['marcus_webb'],
    );
    expect(slow).toBeCloseTo(0.35);
    expect(mid).toBeCloseTo(0.7);
    expect(fast).toBeCloseTo(0.4);
  });

  it('supports the fast layer and clamps at 0.95', async () => {
    const server = build();
    await seedAnchor(server, 'marcus_webb', { fast: 0.94 });

    await server.callTool('support_anchor_precision', {
      id: 'marcus_webb',
      layer: 'fast',
    });
    const stored = await selectPrecision(
      server,
      'SELECT fast_precision AS p FROM anchors WHERE id = ?',
      ['marcus_webb'],
    );
    expect(stored).toBeCloseTo(0.946);
  });

  it('throws on NULL layer precision with a helpful message', async () => {
    const server = build();
    await seedAnchor(server, 'marcus_webb'); // all layers NULL

    await expect(
      server.callTool('support_anchor_precision', {
        id: 'marcus_webb',
        layer: 'mid',
      }),
    ).rejects.toThrow(/precision is not set yet on this anchor\/mid/);
  });

  it('throws on missing anchor id', async () => {
    const server = build();
    await expect(
      server.callTool('support_anchor_precision', {
        id: 'nobody',
        layer: 'slow',
      }),
    ).rejects.toThrow(/anchor\/slow not found: nobody/);
  });
});

describe('relationship layer nudges', () => {
  it('supports the mid layer on a relationship', async () => {
    const server = build();
    await seedAnchor(server, '_principal', { slow: 0.9 });
    await seedAnchor(server, 'marcus_webb', { slow: 0.7 });
    const relId = await seedRelationship(server, '_principal', 'marcus_webb', { mid: 0.5 });

    await server.callTool('support_relationship_precision', {
      id: relId,
      layer: 'mid',
    });
    const stored = await selectPrecision(
      server,
      'SELECT mid_precision AS p FROM relationships WHERE id = ?',
      [relId],
    );
    expect(stored).toBeCloseTo(0.55);
  });

  it('throws on missing relationship id', async () => {
    const server = build();
    await expect(
      server.callTool('contradict_relationship_precision', {
        id: 'rel_missing',
        layer: 'slow',
      }),
    ).rejects.toThrow(/relationship\/slow not found: rel_missing/);
  });
});

describe('input validation', () => {
  it('rejects extra `target` arg on the anchor tool (no shared discriminator)', async () => {
    const server = build();
    await expect(
      server.callTool('support_anchor_precision', {
        target: 'anchor',
        id: 'a1',
        layer: 'slow',
      }),
    ).rejects.toThrow();
  });

  it('rejects missing layer on the anchor tool', async () => {
    const server = build();
    await expect(
      server.callTool('support_anchor_precision', { id: 'a1' }),
    ).rejects.toThrow();
  });

  it('rejects unknown layer values', async () => {
    const server = build();
    await expect(
      server.callTool('contradict_anchor_precision', {
        id: 'a1',
        layer: 'instant',
      }),
    ).rejects.toThrow();
  });

  it('rejects a layer arg on the prediction tool', async () => {
    const server = build();
    await expect(
      server.callTool('support_prediction_precision', { id: 'p1', layer: 'slow' }),
    ).rejects.toThrow();
  });
});

describe('diary role does not get precision tools', () => {
  it('catalog excludes them from diary', () => {
    const server = createSubstrateServer({
      role: 'diary',
      dbPath,
      digestDir,
      now: () => T0,
    });
    const names = new Set(server.listTools());
    for (const name of [
      'support_anchor_precision',
      'contradict_anchor_precision',
      'support_relationship_precision',
      'contradict_relationship_precision',
      'support_prediction_precision',
      'contradict_prediction_precision',
    ]) {
      expect(names.has(name), `diary catalog should not include ${name}`).toBe(false);
    }
  });
});
