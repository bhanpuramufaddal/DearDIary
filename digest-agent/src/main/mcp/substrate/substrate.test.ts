import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createSubstrateServer, type SubstrateServer } from './server.js';
import { CATALOG } from './catalog.js';

const T0 = '2026-05-25T12:00:00-07:00';

let tmp: string;
let dbPath: string;
let digestDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-substrate-test-'));
  digestDir = tmp;
  dbPath = join(tmp, 'digest.db');
  mkdirSync(join(tmp, 'plays'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function build(role: 'mind' | 'diary' | 'cold-start'): SubstrateServer {
  return createSubstrateServer({ role, dbPath, digestDir, now: () => T0 });
}

/**
 * Helper: seed an anchor with one slow-layer write via the typed tools.
 * The id arg is taken as the display_name's slug (so id='marcus_webb' →
 * display_name='Marcus Webb' produces the same slug).
 */
async function seedAnchor(
  server: SubstrateServer,
  id: string,
  slow = 'x',
  precision = 0.5,
): Promise<void> {
  // Slugify-equivalent: replace underscores with spaces, title-case each word.
  const displayName = id
    .replace(/^_/, '')
    .split('_')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
  if (id === '_principal') {
    await server.callTool('create_anchor', {
      display_name: displayName || 'Principal',
      id: '_principal',
      kind: 'person',
    });
  } else {
    await server.callTool('create_anchor', { display_name: displayName, kind: 'person' });
  }
  await server.callTool('update_anchor_layer', {
    id,
    layer: 'slow',
    content: slow,
    precision,
    source_ids: ['seed:1'],
  });
}

describe('catalog scoping (SQL surface)', () => {
  it('every role gets run_sql + file readers', () => {
    for (const role of ['mind', 'diary', 'cold-start'] as const) {
      const names = build(role).listTools();
      expect(names).toContain('run_sql');
      expect(names).toContain('read_profile');
      expect(names).toContain('read_playbook_section');
    }
  });

  it('the deleted reader / mega-mutator tools stay gone for every role', () => {
    // These were the typed reader / one-shot mutator tools removed in favor
    // of the decomposed REST-style surface. Reads happen via run_sql; writes
    // go through small per-resource tools.
    const dead = [
      'list_anchors',
      'read_anchor',
      'list_entities',
      'read_entity',
      'read_principal_anchor',
      'list_diaries',
      'read_diary',
      'list_plays',
      'read_play',
      'list_pending_reminders',
      'write_diary',
      'update_prediction', // the old "apply evidence to prediction + cascade" tool — replaced by the support_*_precision / contradict_*_precision family
      'support_precision', // the old discriminated-union tool — split per target
      'contradict_precision',
      'promote_entity_to_anchor', // renamed to promote_entity in the new surface
    ];
    for (const role of ['mind', 'diary', 'cold-start'] as const) {
      const names = new Set(build(role).listTools());
      for (const d of dead) {
        expect(names.has(d), `${role} should not have ${d}`).toBe(false);
      }
    }
  });

  it('mind no longer has diary OUTPUT writes', () => {
    const names = build('mind').listTools();
    expect(names).not.toContain('write_email_draft_inline');
    expect(names).not.toContain('append_thinking_layer');
  });

  it('mind + cold-start get the precision-nudge tool family; diary does not', () => {
    const family = [
      'support_anchor_precision',
      'contradict_anchor_precision',
      'support_relationship_precision',
      'contradict_relationship_precision',
      'support_prediction_precision',
      'contradict_prediction_precision',
    ];
    const mind = new Set(build('mind').listTools());
    const cold = new Set(build('cold-start').listTools());
    const diary = new Set(build('diary').listTools());
    for (const name of family) {
      expect(mind.has(name), `mind should have ${name}`).toBe(true);
      expect(cold.has(name), `cold-start should have ${name}`).toBe(true);
      expect(diary.has(name), `diary should NOT have ${name}`).toBe(false);
    }
  });

  it('cold-start and mind both have create_play; cold-start === mind surface', () => {
    const mind = new Set(build('mind').listTools());
    const cold = new Set(build('cold-start').listTools());
    // cold-start is identical to mind — both include create_play now.
    expect(mind.has('create_play')).toBe(true);
    expect(cold.has('create_play')).toBe(true);
    expect([...mind]).toEqual([...cold]);
  });

  it('diary does not get any mind-model write tools', () => {
    const diary = new Set(build('diary').listTools());
    const writeTools = [
      'create_anchor',
      'update_anchor_layer',
      'create_entity',
      'bump_entity',
      'create_relationship',
      'create_prediction',
      'set_reminder',
      'cite',
      'update_identity_handles',
      'create_play',
    ];
    for (const t of writeTools) expect(diary.has(t), `diary should not have ${t}`).toBe(false);
  });

  it('diary keeps its OUTPUT writes alongside read-only run_sql', () => {
    const names = build('diary').listTools();
    expect(names).toContain('run_sql');
    expect(names).toContain('write_email_draft_inline');
    expect(names).toContain('append_thinking_layer');
    expect(names).toContain('emit_efference_prediction');
    expect(names).toContain('clear_diary');
  });

  it('every catalog name resolves to an implemented tool', () => {
    expect(() => build('mind')).not.toThrow();
    expect(() => build('diary')).not.toThrow();
    expect(() => build('cold-start')).not.toThrow();
    expect(CATALOG.mind.length).toBeGreaterThan(0);
    expect(CATALOG.diary.length).toBeGreaterThan(0);
    expect(CATALOG['cold-start'].length).toBeGreaterThan(0);
  });
});

describe('cold-start seeds the _principal anchor via typed tools', () => {
  it('reads profile.md and creates _principal with slow layer + citation', async () => {
    writeFileSync(join(digestDir, 'profile.md'), 'Avery Chen, founder. Day starts at 6am Pacific.');
    const cs = build('cold-start');

    const profile = (await cs.callTool('read_profile', {})) as { content: string };
    expect(profile.content).toContain('Avery Chen, founder');

    await cs.callTool('create_anchor', {
      display_name: 'Avery Chen',
      id: '_principal',
      kind: 'person',
    });
    await cs.callTool('update_anchor_layer', {
      id: '_principal',
      layer: 'slow',
      content: 'Avery Chen, founder. Signs as "avery".',
      precision: 0.7,
      source_ids: ['profile.md'],
      date: '2026-05-25',
    });

    // Read back via a fresh mind server (shares the DB file).
    const mind = build('mind');
    const res = (await mind.callTool('run_sql', {
      sql: "SELECT slow_content, slow_precision FROM anchors WHERE id = '_principal'",
    })) as { rows: { slow_content: string; slow_precision: number }[] };
    expect(res.rows[0]!.slow_content).toContain('Avery Chen, founder');
    expect(res.rows[0]!.slow_precision).toBeCloseTo(0.7);

    const cb = (await mind.callTool('run_sql', {
      sql: "SELECT source_id FROM case_base_entries WHERE node_id='_principal' AND layer='slow'",
    })) as { rows: { source_id: string }[] };
    expect(cb.rows[0]!.source_id).toBe('profile.md');
  });
});

describe('diary OUTPUT round-trips (structured tools survive)', () => {
  it('append_thinking_layer adds a journal entry readable via run_sql', async () => {
    const diary = build('diary');
    await diary.callTool('append_thinking_layer', {
      date: '2026-05-25',
      tick_at: T0,
      entries: ['Marcus quiet 48h — within range', 'Renee EOD → lead component'],
    });
    const res = (await diary.callTool('run_sql', {
      sql: "SELECT entries FROM diary_thinking_entries WHERE diary_date = '2026-05-25'",
    })) as { rows: { entries: string }[] };
    expect(res.rows).toHaveLength(1);
    expect(JSON.parse(res.rows[0]!.entries)).toContain('Marcus quiet 48h — within range');
  });

  it('write_email_draft_inline + emit_efference_prediction links the component', async () => {
    // Anchor must exist (component anchor_refs FK + prediction FK). Seed via mind SQL.
    const mind = build('mind');
    await seedAnchor(mind, 'marcus_webb');

    const diary = build('diary');
    await diary.callTool('write_email_draft_inline', {
      date: '2026-05-25',
      id: 'cmp_1',
      section: 'urgent_todo',
      headline: 'Reply to Marcus',
      anchor_refs: ['marcus_webb'],
      content: {
        context_summary:
          'Marcus asked for the cap table Tuesday; you owe a reply with the v3 numbers.',
        to: ['marcus@example.com'],
        subject: 'Re: cap table',
        body: 'marcus — sending v3 now. numbers hold.\n\navery',
      },
      actions: [{ id: 'send', label: 'Send', kind: 'send_email' }],
    });

    const res = (await diary.callTool('emit_efference_prediction', {
      id: 'pred_1',
      anchor_id: 'marcus_webb',
      diary_date: '2026-05-25',
      component_id: 'cmp_1',
      claim: 'Marcus replies within 48h',
      expected_by: '2026-05-27T17:00:00-07:00',
      based_on: ['mid'],
      precision: 0.65,
    })) as { prediction_id: string };
    expect(res.prediction_id).toBe('pred_1');

    // The prediction exists and the component carries the FK — verify via run_sql.
    const preds = (await mind.callTool('run_sql', {
      sql: "SELECT id, source_dispatchable FROM predictions WHERE anchor_id = 'marcus_webb'",
    })) as { rows: { id: string; source_dispatchable: string }[] };
    expect(preds.rows[0]).toMatchObject({
      id: 'pred_1',
      source_dispatchable: 'diary/2026-05-25#cmp_1',
    });
    const comp = (await mind.callTool('run_sql', {
      sql: "SELECT efference_prediction_id FROM diary_components WHERE id = 'cmp_1'",
    })) as { rows: { efference_prediction_id: string }[] };
    expect(comp.rows[0]!.efference_prediction_id).toBe('pred_1');
  });
});

describe('runtime tool errors', () => {
  it('callTool throws on unknown tool name', async () => {
    const server = build('mind');
    await expect(server.callTool('not_a_tool', {})).rejects.toThrow(/unknown tool/);
  });

  it('run_sql surfaces SQL errors (e.g. unknown table)', async () => {
    const server = build('mind');
    await expect(
      server.callTool('run_sql', { sql: 'SELECT * FROM no_such_table' }),
    ).rejects.toThrow();
  });
});
