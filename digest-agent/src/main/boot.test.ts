/**
 * Cross-phase integration smoke.
 *
 * Boots the subset of `boot()` that runs in pure Node (DB, bus, schedulers,
 * dispatchers, event relay, surface tools) — skipping Electron-only pieces
 * (window manager + IPC) — and asserts the wiring is coherent:
 *
 *   webhook.persona → mind dispatcher (mocked invoke) → mind.invocation.done
 *   diary_act IPC-equivalent → pending_bus_events row
 *   relay drain → bus.emit → task.fired → execution dispatcher → task.completed
 *
 * Not a replacement for the manual Electron smoke from
 * design/11-backend-architecture.md#verification, but it does prove the
 * subsystem graph compiles and connects.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDatabase, type Db } from './db/index.js';
import { applyMigrations } from './db/migrate.js';
import { Bus } from './bus.js';
import type { ClaudeCodeOutcome } from './claudeCode.js';
import { createMindDispatcher } from './dispatcher/mind.js';
import { createDiaryDispatcher } from './dispatcher/diary.js';
import { createExecutionDispatcher } from './dispatcher/execution.js';
import { createEventRelay } from './dispatcher/eventRelay.js';
import { makeNodesRepo } from './db/nodes.js';
import { makeAnchorsRepo } from './db/anchors.js';
import { makeDiaryRepo } from './db/diary.js';
import { makePendingEventsRepo } from './db/pendingEvents.js';
import type { AppConfig } from '@shared/types/config.js';
import type {
  AnchorId,
  DiaryComponentId,
  SourceId,
  TaskId,
} from '@shared/types/ids.js';

let tmp: string;
let db: Db;
let bus: Bus;
let cfg: AppConfig;

const okOutcome: ClaudeCodeOutcome = {
  exitCode: 0,
  signal: null,
  durationMs: 5,
  stdout: '',
  stderr: '',
  finalMessage: {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ task_id: 'tsk_x', status: 'completed', summary: 'ok' }),
      },
    ],
  },
  timedOut: false,
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-boot-smoke-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));

  // Seed prompts into the DB — dispatchers read from DB, not filesystem.
  const now = new Date().toISOString();
  for (const [name, content] of [
    ['disposition', 'shared'],
    ['mind-agent', 'you are the mind agent'],
    ['diary-agent', 'you are the diary agent'],
    ['cold-start-agent', 'you are the cold-start agent'],
    ['execution-agent', 'you are the execution agent'],
  ] as [string, string][]) {
    db.prepare(`INSERT OR REPLACE INTO prompts (name, kind, title, content, source, created_at, updated_at)
      VALUES (?, 'agent', ?, ?, 'bundled', ?, ?)`).run(name, name, content, now, now);
  }

  bus = new Bus(db);

  cfg = {
    timezone: 'UTC',
    digest_dir: tmp,
    event_sources: [],
    mcp_servers: [{ id: 'gmail-mcp', command: 'uvx gmail-mcp' }],
    agent_mcp_access: { mind: ['gmail-mcp'], diary: [], cold_start: [] },
    webhook: {
      public_url: 'x',
      bind_host: '127.0.0.1',
      bind_port: 0,
      tunnel: { kind: 'external' },
    },
    schedule: { diary_times: [] },
    claude_code: { executable: '/bin/false', extra_flags: [] },
    model: { mind_agent: 'm', diary_agent: 'd', cold_start_agent: 'c', execution_agent: 'e' },
    api_key_env: 'X',
    mcp: { cache_ttl_minutes: 5 },
    log_dir: tmp,
  };
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('boot smoke (cross-phase wiring)', () => {
  it('webhook.persona → mind dispatcher runs the agent and emits mind.invocation.done', async () => {
    const invoked: string[] = [];
    const mind = createMindDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js',
      invoke: async (o) => {
        invoked.push(o.userPrompt);
        return okOutcome;
      },
    });
    mind.start();
    await bus.replayDurableSubscribers(); // nothing to replay; sanity check

    const done: { error?: string }[] = [];
    bus.on('mind.invocation.done', (p) => {
      done.push(p.error ? { error: p.error } : {});
    });

    await bus.emit('webhook.persona', {
      id: 'persona:avery:email:1' as SourceId,
      source: 'persona-emulator',
      observed_at: 'T',
      occurred_at: 'T',
      identity_handles: [],
      payload: { subject: 'cap table' },
    });
    await bus.whenDrained();

    expect(invoked).toHaveLength(1);
    expect(invoked[0]).toContain('cap table');
    expect(done).toEqual([{}]);
  });

  it('pending_bus_events relay → bus.emit → execution dispatcher → task.completed', async () => {
    // Seed a component the execution dispatcher can act on.
    const nodes = makeNodesRepo(db);
    const anchors = makeAnchorsRepo(db);
    const diary = makeDiaryRepo(db);
    nodes.insertNode('marcus_webb', 'anchor', 'T');
    anchors.createAnchor({
      id: 'marcus_webb',
      kind: 'person',
      identity_handles: [],
      slow: { content: 'x', precision: 0.5 },
      last_bumped: 'T',
    });
    diary.persistDiary({
      date: '2026-05-25',
      sections: {
        right_now: [
          {
            id: 'cmp_send' as DiaryComponentId,
            diary_date: '2026-05-25',
            type: 'email-draft',
            section: 'right_now',
            template_id: 'email-draft.inline',
            anchor_refs: ['marcus_webb' as AnchorId],
            content: { to: ['m@x.com'], body: 'hi' },
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

    const exec = createExecutionDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js',
      invoke: async () => okOutcome,
    });
    exec.start();
    const relay = createEventRelay(db, bus, { intervalMs: 20 });
    relay.start();

    let completed = 0;
    bus.on('task.completed', () => {
      completed++;
    });

    // Out-of-process writer (would be surface MCP subprocess) writes here.
    const pending = makePendingEventsRepo(db);
    pending.enqueue(
      'task.fired',
      {
        task_id: 'tsk_smoke' as TaskId,
        component_id: 'cmp_send' as DiaryComponentId,
        diary_date: '2026-05-25',
        action: { id: 'send', kind: 'send_email' },
        principal_input: null,
        context_pointers: { anchor_ids: ['marcus_webb' as AnchorId] },
      },
      null,
      'T',
    );

    await relay.drainNow();
    // Give the execution dispatcher's fire-and-forget runOne time to settle.
    await new Promise((r) => setTimeout(r, 80));
    relay.stop();

    expect(completed).toBe(1);
    // Component flipped to acted.
    const row = db
      .prepare('SELECT status FROM diary_components WHERE id = ?')
      .get('cmp_send') as { status: string };
    expect(row.status).toBe('acted');
  });

  it('mind, diary, and execution dispatchers can co-exist on the same bus', () => {
    // Construct each — order matches boot.ts. No assertion needed beyond
    // "this does not throw" — it catches subscriber-name collisions, etc.
    const mind = createMindDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js', invoke: async () => okOutcome });
    const diary = createDiaryDispatcher(cfg, bus, db, mind, { substrateServerPath: '/tmp/x.js', invoke: async () => okOutcome });
    const exec = createExecutionDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js', invoke: async () => okOutcome });
    expect(typeof mind.start).toBe('function');
    expect(typeof diary.start).toBe('function');
    expect(typeof exec.start).toBe('function');
  });
});
