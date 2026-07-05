import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { openDatabase, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { Bus } from '../../bus.js';
import { makePendingEventsRepo } from '../../db/pendingEvents.js';
import { makeNodesRepo } from '../../db/nodes.js';
import { makeAnchorsRepo } from '../../db/anchors.js';
import { makeDiaryRepo } from '../../db/diary.js';
import { createSurfaceServer, type SurfaceServer } from './server.js';
import { createEventRelay } from '../../dispatcher/eventRelay.js';
import type { AnchorId, DiaryComponentId } from '@shared/types/ids.js';

const T0 = '2026-05-25T12:00:00-07:00';
let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-surface-test-'));
  dbPath = join(tmp, 'digest.db');
  mkdirSync(join(tmp, 'plays'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function build(): SurfaceServer {
  return createSurfaceServer({
    dbPath,
    digestDir: tmp,
    now: () => T0,
    diaryRunPollMs: 50,
    diaryRunTimeoutMs: 5000,
  });
}

function seedDiaryComponent(): { db: Db; componentId: string; anchorId: string } {
  const db = openDatabase(dbPath);
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
  const nodes = makeNodesRepo(db);
  const anchors = makeAnchorsRepo(db);
  const diary = makeDiaryRepo(db);

  nodes.insertNode('marcus_webb', 'anchor', T0);
  anchors.createAnchor({
    id: 'marcus_webb',
    kind: 'person',
    identity_handles: [],
    slow: { content: 'x', precision: 0.5 },
    last_bumped: T0,
  });

  diary.persistDiary({
    date: '2026-05-25',
    sections: {
      right_now: [
        {
          id: 'cmp_1' as DiaryComponentId,
          diary_date: '2026-05-25',
          type: 'email-draft',
          section: 'right_now',
          template_id: 'email-draft.inline',
          anchor_refs: ['marcus_webb' as AnchorId],
          content: { subject: 'hi' },
          actions: [{ id: 'send', label: 'Send', kind: 'send_email' }],
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

  return { db, componentId: 'cmp_1', anchorId: 'marcus_webb' };
}

describe('surface MCP catalog', () => {
  it('exposes exactly the five tools', () => {
    const server = build();
    expect(server.listTools().sort()).toEqual([
      'diary_act',
      'diary_add_comment',
      'diary_add_note',
      'digest_get',
      'digest_run',
    ]);
  });
});

describe('digest_get', () => {
  it('returns today\'s diary JSON when no date is given', async () => {
    const { db } = seedDiaryComponent();
    db.close();

    const server = build();
    // "Today" is derived from ctx.now() (the simulated T0), not wall clock,
    // so the no-arg digest_get returns the date that matches T0.
    const today = T0.slice(0, 10);

    // Make sure assembleDiary can find our seeded date by passing it explicitly.
    const result = (await server.callTool('digest_get', { date: '2026-05-25' })) as {
      sections: { right_now: unknown[] };
    };
    expect(result.sections.right_now).toHaveLength(1);

    // No-arg defaults to today (may be empty if seeded date != today).
    const today_diary = (await server.callTool('digest_get', {})) as {
      date: string;
      sections: { right_now: unknown[] };
    };
    expect(today_diary.date).toBe(today);
  });
});

describe('diary_act', () => {
  it('enqueues task.fired with the component and action', async () => {
    const { db } = seedDiaryComponent();
    db.close();

    const server = build();
    const result = (await server.callTool('diary_act', {
      component_id: 'cmp_1',
      action: { id: 'send', kind: 'send_email' },
      principal_input: { tweak: 'looks good' },
    })) as { task_id: string };

    expect(result.task_id).toBeTruthy();

    // The relay queue has one pending row of kind task.fired.
    const probe = openDatabase(dbPath);
    const pending = makePendingEventsRepo(probe);
    const drained = pending.drainOldest(10);
    expect(drained).toHaveLength(1);
    expect(drained[0]!.kind).toBe('task.fired');
    const payload = JSON.parse(drained[0]!.payload) as {
      task_id: string;
      component_id: string;
      diary_date: string;
      action: { kind: string };
      context_pointers: { anchor_ids: string[] };
    };
    expect(payload.component_id).toBe('cmp_1');
    expect(payload.diary_date).toBe('2026-05-25');
    expect(payload.action.kind).toBe('send_email');
    expect(payload.context_pointers.anchor_ids).toEqual(['marcus_webb']);
    probe.close();
  });

  it('throws on unknown component_id', async () => {
    const { db } = seedDiaryComponent();
    db.close();
    const server = build();
    await expect(
      server.callTool('diary_act', {
        component_id: 'no_such',
        action: { id: 'send', kind: 'send_email' },
      }),
    ).rejects.toThrow(/component not found/);
  });
});

describe('diary_add_comment', () => {
  it('inserts row + enqueues diary.comment.added', async () => {
    const { db } = seedDiaryComponent();
    db.close();

    const server = build();
    const res = (await server.callTool('diary_add_comment', {
      component_id: 'cmp_1',
      text: 'looks good — send it',
    })) as { id: string };

    expect(res.id).toMatch(/^cmt_/);

    const probe = openDatabase(dbPath);
    // Comment row landed in diary_comments.
    const row = probe
      .prepare('SELECT id, text FROM diary_comments WHERE component_id = ?')
      .get('cmp_1') as { id: string; text: string };
    expect(row.text).toBe('looks good — send it');

    // Relay queue has the bus event.
    const pending = makePendingEventsRepo(probe);
    const drained = pending.drainOldest(10);
    expect(drained).toHaveLength(1);
    expect(drained[0]!.kind).toBe('diary.comment.added');
    probe.close();
  });

  it('throws a clear error when the component does not exist', async () => {
    const { db } = seedDiaryComponent();
    db.close();
    const server = build();
    await expect(
      server.callTool('diary_add_comment', { component_id: 'no_such', text: 'hi' }),
    ).rejects.toThrow(/component not found/);
  });
});

describe('diary_add_note', () => {
  it('inserts row + enqueues diary.note.added; defaults date to today', async () => {
    const { db } = seedDiaryComponent();
    db.close();

    const server = build();
    const res = (await server.callTool('diary_add_note', {
      text: 'push cap table tonight',
    })) as { id: string };
    expect(res.id).toMatch(/^note_/);

    const probe = openDatabase(dbPath);
    // "Today" is derived from ctx.now() (simulated T0), not wall clock.
    const today = T0.slice(0, 10);
    const row = probe
      .prepare('SELECT diary_date, text FROM diary_notes WHERE id = ?')
      .get(res.id) as { diary_date: string; text: string };
    expect(row.diary_date).toBe(today);
    expect(row.text).toBe('push cap table tonight');

    const pending = makePendingEventsRepo(probe);
    const drained = pending.drainOldest(10);
    expect(drained.find((r) => r.kind === 'diary.note.added')).toBeTruthy();
    probe.close();
  });
});

describe('digest_run end-to-end (relay + diary completion event)', () => {
  it('blocks until a diary.invocation.done event arrives, then returns the diary', async () => {
    const { db } = seedDiaryComponent();
    // Set up the in-process bus + relay + a fake "diary dispatcher" that
    // pretends to compose by emitting diary.invocation.done after a short delay.
    const bus = new Bus(db);
    bus.on('schedule.diary_tick', async () => {
      // Pretend composition took 200ms.
      await new Promise((r) => setTimeout(r, 100));
      await bus.emit('diary.invocation.done', {
        invocation_id: 'inv_test',
        role: 'diary',
        exit_code: 0,
        duration_ms: 100,
      });
    });
    const relay = createEventRelay(db, bus, { intervalMs: 20 });
    relay.start();

    const server = build();
    const result = (await server.callTool('digest_run', {})) as {
      date: string;
      sections: { right_now: unknown[] };
    };
    expect(result.date).toBe('2026-05-25');
    expect(result.sections.right_now).toHaveLength(1);

    relay.stop();
    db.close();
  });

  it('times out when no diary.invocation.done arrives', async () => {
    const { db } = seedDiaryComponent();
    db.close();
    const server = createSurfaceServer({
      dbPath,
      digestDir: tmp,
      now: () => T0,
      diaryRunPollMs: 20,
      diaryRunTimeoutMs: 100,
    });

    await expect(server.callTool('digest_run', {})).rejects.toThrow(/timed out/);
  });
});
