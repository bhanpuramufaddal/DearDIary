import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AnchorId, EntityId, RelationshipId, PredictionId } from '@shared/types/ids.js';
import { mkSourceId } from '@shared/types/ids.js';
import { openDatabase, type Db } from './index.js';
import { applyMigrations } from './migrate.js';
import { makeNodesRepo } from './nodes.js';
import { makeAnchorsRepo } from './anchors.js';
import { makeEntitiesRepo } from './entities.js';
import { makeRelationshipsRepo } from './relationships.js';
import { makePredictionsRepo } from './predictions.js';
import { makeCaseBaseRepo } from './caseBase.js';

const T = '2026-05-25T12:00:00-07:00';
const D = '2026-05-25';

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('migrations', () => {
  it('apply cleanly and bump user_version', () => {
    const v = (db.pragma('user_version', { simple: true }) as number) ?? 0;
    expect(v).toBeGreaterThan(0);
  });
});

describe('nodes + anchors + entities CRUD', () => {
  it('creates an anchor with parent node row', () => {
    const nodes = makeNodesRepo(db);
    const anchors = makeAnchorsRepo(db);
    nodes.insertNode('marcus_webb', 'anchor', T);
    anchors.createAnchor({
      id: 'marcus_webb',
      kind: 'person',
      identity_handles: ['Marcus Webb'],
      slow: { content: 'Lead partner.', precision: 0.78 },
      last_bumped: T,
    });

    const row = anchors.readAnchor('marcus_webb' as AnchorId);
    expect(row?.kind).toBe('person');
    expect(row?.slow_precision).toBeCloseTo(0.78);
    expect(JSON.parse(row!.identity_handles)).toEqual(['Marcus Webb']);
  });

  it('creates an entity', () => {
    const nodes = makeNodesRepo(db);
    const entities = makeEntitiesRepo(db);
    nodes.insertNode('sarah_chen', 'entity', T);
    entities.createEntity({
      id: 'sarah_chen',
      kind: 'person',
      identity_handles: ['Sarah Chen'],
      first_seen: T,
    });
    expect(entities.readEntity('sarah_chen' as EntityId)?.mention_count).toBe(1);
  });
});

describe('relationships', () => {
  it('enforces target must be an anchor (trigger)', () => {
    const nodes = makeNodesRepo(db);
    const entities = makeEntitiesRepo(db);
    const relationships = makeRelationshipsRepo(db);

    nodes.insertNode('subj', 'entity', T);
    entities.createEntity({ id: 'subj', kind: 'person', identity_handles: [], first_seen: T });

    nodes.insertNode('targ', 'entity', T);
    entities.createEntity({ id: 'targ', kind: 'person', identity_handles: [], first_seen: T });

    expect(() =>
      relationships.createRelationship({
        id: 'rel1',
        subject_id: 'subj' as EntityId,
        target_id: 'targ' as unknown as AnchorId, // ← entity disguised as anchor
        slow: { claim: 'x', precision: 0.5 },
        mid: { claim: 'x', precision: 0.5 },
        fast: { claim: 'x', precision: 0.5 },
      }),
    ).toThrow(/anchor/);
  });

  it('cascades on subject node delete', () => {
    const nodes = makeNodesRepo(db);
    const anchors = makeAnchorsRepo(db);
    const entities = makeEntitiesRepo(db);
    const relationships = makeRelationshipsRepo(db);

    nodes.insertNode('marcus_webb', 'anchor', T);
    anchors.createAnchor({
      id: 'marcus_webb',
      kind: 'person',
      identity_handles: [],
      slow: { content: 'x', precision: 0.5 },
      last_bumped: T,
    });

    nodes.insertNode('sarah_chen', 'entity', T);
    entities.createEntity({ id: 'sarah_chen', kind: 'person', identity_handles: [], first_seen: T });

    relationships.createRelationship({
      id: 'rel1',
      subject_id: 'sarah_chen' as EntityId,
      target_id: 'marcus_webb' as AnchorId,
      slow: { claim: 'works under Marcus', precision: 0.7 },
      mid: { claim: 'on cap table', precision: 0.5 },
      fast: { claim: '—', precision: 0.5 },
    });

    nodes.deleteNode('sarah_chen' as EntityId);

    expect(relationships.readRelationship('rel1' as RelationshipId)).toBeNull();
  });
});

describe('predictions + precision arithmetic cascade', () => {
  it('applyEvidence updates prediction precision and all bound anchor layers', () => {
    const nodes = makeNodesRepo(db);
    const anchors = makeAnchorsRepo(db);
    const predictions = makePredictionsRepo(db);

    nodes.insertNode('a1', 'anchor', T);
    anchors.createAnchor({
      id: 'a1',
      kind: 'person',
      identity_handles: [],
      slow: { content: 'x', precision: 0.5 },
      mid: { content: 'y', precision: 0.5 },
      fast: { content: 'z', precision: 0.5 },
      last_bumped: T,
    });
    predictions.createPrediction({
      id: 'p1',
      anchor_id: 'a1' as AnchorId,
      kind: 'event',
      claim: 'X happens by Tue',
      expected_by: T,
      based_on: ['mid', 'fast'],
      precision: 0.5,
      created_at: T,
    });

    const result = predictions.applyEvidence('p1' as PredictionId, 'support');
    expect(result?.prediction_precision).toBeCloseTo(0.55, 6);
    expect(result?.layer_precisions.mid).toBeCloseTo(0.55, 6);
    expect(result?.layer_precisions.fast).toBeCloseTo(0.55, 6);

    // Slow layer was NOT bound → not updated.
    const after = anchors.readAnchor('a1' as AnchorId)!;
    expect(after.slow_precision).toBeCloseTo(0.5, 6);
    expect(after.mid_precision).toBeCloseTo(0.55, 6);
    expect(after.fast_precision).toBeCloseTo(0.55, 6);
  });
});

describe('case_base_entries', () => {
  it('inserts with auto-position and queries by source_id', () => {
    const nodes = makeNodesRepo(db);
    const anchors = makeAnchorsRepo(db);
    const caseBase = makeCaseBaseRepo(db);

    nodes.insertNode('a1', 'anchor', T);
    anchors.createAnchor({
      id: 'a1',
      kind: 'person',
      identity_handles: [],
      slow: { content: 'x', precision: 0.5 },
      last_bumped: T,
    });

    caseBase.addEntry({
      id: 'c1',
      node_id: 'a1' as AnchorId,
      layer: 'slow',
      source_id: mkSourceId('gmail:msg_abc'),
      date: D,
      note: 'first reply',
    });
    caseBase.addEntry({
      id: 'c2',
      node_id: 'a1' as AnchorId,
      layer: 'slow',
      source_id: mkSourceId('gmail:msg_def'),
      date: D,
    });

    const entries = caseBase.listByNodeLayer('a1' as AnchorId, 'slow');
    expect(entries.map((e) => e.position)).toEqual([0, 1]);

    const bySource = caseBase.listBySourceId(mkSourceId('gmail:msg_abc'));
    expect(bySource).toHaveLength(1);
    expect(bySource[0]?.note).toBe('first reply');
  });
});

describe('diary persistence', () => {
  it('preserves comments across a re-tick that keeps the component id', async () => {
    const { makeDiaryRepo } = await import('./diary.js');
    const { makeNodesRepo } = await import('./nodes.js');
    const { makeAnchorsRepo } = await import('./anchors.js');
    const diary = makeDiaryRepo(db);
    const nodes = makeNodesRepo(db);
    const anchors = makeAnchorsRepo(db);

    nodes.insertNode('marcus_webb', 'anchor', T);
    anchors.createAnchor({
      id: 'marcus_webb',
      kind: 'person',
      identity_handles: [],
      slow: { content: 'x', precision: 0.5 },
      last_bumped: T,
    });

    // First tick: one component.
    diary.persistDiary({
      date: D,
      sections: {
        right_now: [
          {
            id: 'cmp_1' as any,
            diary_date: D,
            type: 'email-draft',
            section: 'right_now',
            template_id: 'email-draft.inline',
            anchor_refs: ['marcus_webb' as AnchorId],
            content: { subject: 'hi' },
            actions: [],
            status: 'open',
            comments: [],
          },
        ],
        on_the_desk: [],
        tracking: [],
        background: [],
      },
      notes: [],
      thinking_layer: [],
    });

    // Principal adds a comment.
    diary.addComment('cmp_1' as any, 'cmt_1', 'looks good', T);
    expect(diary.assembleDiary(D).sections.right_now![0]!.comments).toHaveLength(1);

    // Re-tick: same component id, refined rationale; comment must survive.
    diary.persistDiary({
      date: D,
      sections: {
        right_now: [
          {
            id: 'cmp_1' as any,
            diary_date: D,
            type: 'calendar-block',
            section: 'right_now',
            template_id: 'calendar-block.decision', // template_id changed
            anchor_refs: ['marcus_webb' as AnchorId],
            rationale: 'refined',
            content: { subject: 'hi' },
            actions: [],
            status: 'open',
            comments: [],
          },
        ],
        on_the_desk: [],
        tracking: [],
        background: [],
      },
      notes: [],
      thinking_layer: [],
    });

    const after = diary.assembleDiary(D);
    expect(after.sections.right_now![0]!.template_id).toBe('calendar-block.decision');
    expect(after.sections.right_now![0]!.comments).toHaveLength(1);
    expect(after.sections.right_now![0]!.comments[0]!.text).toBe('looks good');
  });

  it('drops a component (and its comments) when the re-tick omits its id', async () => {
    const { makeDiaryRepo } = await import('./diary.js');
    const { makeNodesRepo } = await import('./nodes.js');
    const { makeAnchorsRepo } = await import('./anchors.js');
    const diary = makeDiaryRepo(db);
    const nodes = makeNodesRepo(db);
    const anchors = makeAnchorsRepo(db);

    nodes.insertNode('m', 'anchor', T);
    anchors.createAnchor({
      id: 'm',
      kind: 'person',
      identity_handles: [],
      slow: { content: 'x', precision: 0.5 },
      last_bumped: T,
    });

    diary.persistDiary({
      date: D,
      sections: {
        right_now: [
          {
            id: 'cmp_1' as any,
            diary_date: D,
            type: 'email-draft',
            section: 'right_now',
            template_id: 'email-draft.inline',
            anchor_refs: ['m' as AnchorId],
            content: {},
            actions: [],
            status: 'open',
            comments: [],
          },
        ],
        on_the_desk: [],
        tracking: [],
        background: [],
      },
      notes: [],
      thinking_layer: [],
    });
    diary.addComment('cmp_1' as any, 'cmt_x', 'about cmp_1', T);

    // Re-tick: cmp_1 dropped; new component cmp_2 in its place.
    diary.persistDiary({
      date: D,
      sections: {
        right_now: [
          {
            id: 'cmp_2' as any,
            diary_date: D,
            type: 'email-draft',
            section: 'right_now',
            template_id: 'email-draft.inline',
            anchor_refs: ['m' as AnchorId],
            content: {},
            actions: [],
            status: 'open',
            comments: [],
          },
        ],
        on_the_desk: [],
        tracking: [],
        background: [],
      },
      notes: [],
      thinking_layer: [],
    });

    const after = diary.assembleDiary(D);
    expect(after.sections.right_now).toHaveLength(1);
    expect(after.sections.right_now![0]!.id).toBe('cmp_2');
    // cmp_1's comment is gone (cascade-deleted with the component).
    expect(after.sections.right_now![0]!.comments).toHaveLength(0);
  });
});

describe('schema constraints', () => {
  it('predictions.expected_by CHECK: required for event, forbidden otherwise', async () => {
    const { makeNodesRepo } = await import('./nodes.js');
    const { makeAnchorsRepo } = await import('./anchors.js');
    const { makePredictionsRepo } = await import('./predictions.js');
    const nodes = makeNodesRepo(db);
    const anchors = makeAnchorsRepo(db);
    const predictions = makePredictionsRepo(db);

    nodes.insertNode('a1', 'anchor', T);
    anchors.createAnchor({
      id: 'a1',
      kind: 'person',
      identity_handles: [],
      slow: { content: 'x', precision: 0.5 },
      last_bumped: T,
    });

    // event without expected_by → rejected
    expect(() =>
      predictions.createPrediction({
        id: 'p_bad',
        anchor_id: 'a1' as AnchorId,
        kind: 'event',
        claim: 'x',
        based_on: ['slow'],
        precision: 0.5,
        created_at: T,
      }),
    ).toThrow(/CHECK/);

    // fact with expected_by → rejected
    expect(() =>
      predictions.createPrediction({
        id: 'p_bad2',
        anchor_id: 'a1' as AnchorId,
        kind: 'fact',
        claim: 'x',
        expected_by: T,
        based_on: ['slow'],
        precision: 0.5,
        created_at: T,
      }),
    ).toThrow(/CHECK/);

    // event with expected_by → ok
    expect(() =>
      predictions.createPrediction({
        id: 'p_ok',
        anchor_id: 'a1' as AnchorId,
        kind: 'event',
        claim: 'x',
        expected_by: T,
        based_on: ['slow'],
        precision: 0.5,
        created_at: T,
      }),
    ).not.toThrow();
  });
});
