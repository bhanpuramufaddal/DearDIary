/**
 * Dispatcher tests — verify that mind/diary/cold-start dispatchers spawn the
 * right invocation in response to the right bus event, with the right MCP
 * scoping, in the right order. The actual `claude` CLI is mocked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { Bus } from '../bus.js';
import type { ClaudeCodeOutcome } from '../claudeCode.js';
import { createMindDispatcher } from './mind.js';
import { createDiaryDispatcher } from './diary.js';
import { createColdStartDispatcher } from './coldStart.js';
import type { AppConfig } from '@shared/types/config.js';

let tmp: string;
let db: Db;
let bus: Bus;
let cfg: AppConfig;

function makeConfig(): AppConfig {
  return {
    timezone: 'UTC',
    digest_dir: tmp,
    event_sources: [],
    mcp_servers: [{ id: 'gmail-mcp', command: 'uvx gmail-mcp' }],
    agent_mcp_access: { mind: ['gmail-mcp'], diary: ['gmail-mcp'], cold_start: [] },
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
}

interface InvocationLog {
  role: string;
  userPrompt: string;
  mcpServerKeys: string[];
}

function mockInvoke(
  log: InvocationLog[],
  responses: ClaudeCodeOutcome | (() => Promise<ClaudeCodeOutcome>),
) {
  return async (opts: {
    systemPrompt: string;
    userPrompt: string;
    mcpConfig: { mcpServers: Record<string, unknown> };
  }): Promise<ClaudeCodeOutcome> => {
    log.push({
      role: opts.systemPrompt.includes('mind agent')
        ? 'mind'
        : opts.systemPrompt.includes('diary agent')
          ? 'diary'
          : opts.systemPrompt.includes('cold-start')
            ? 'cold-start'
            : 'unknown',
      userPrompt: opts.userPrompt,
      mcpServerKeys: Object.keys(opts.mcpConfig.mcpServers).sort(),
    });
    return typeof responses === 'function' ? responses() : responses;
  };
}

const okOutcome: ClaudeCodeOutcome = {
  exitCode: 0,
  signal: null,
  durationMs: 10,
  stdout: '',
  stderr: '',
  finalMessage: { content: [{ type: 'text', text: 'done' }] },
  timedOut: false,
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-disp-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));

  // Seed prompts directly into the DB — the dispatchers now read from DB,
  // not from the filesystem. Marker text lets the mock detect which role fired.
  const now = new Date().toISOString();
  const insertPrompt = (name: string, content: string): void => {
    db.prepare(`INSERT OR REPLACE INTO prompts (name, kind, title, content, source, created_at, updated_at)
      VALUES (?, 'agent', ?, ?, 'bundled', ?, ?)`).run(name, name, content, now, now);
  };
  insertPrompt('disposition', 'shared disposition');
  insertPrompt('mind-agent', 'you are the mind agent');
  insertPrompt('diary-agent', 'you are the diary agent');
  insertPrompt('cold-start-agent', 'you are the cold-start agent');
  insertPrompt('cold-start-validator-agent', 'you are the cold-start validator agent');

  bus = new Bus(db);
  cfg = makeConfig();
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('mind dispatcher', () => {
  it('fires on webhook.persona and emits mind.invocation.done', async () => {
    const log: InvocationLog[] = [];
    const done: { exit_code: number; error?: string }[] = [];
    bus.on('mind.invocation.done', (p) => {
      done.push({ exit_code: p.exit_code, ...(p.error ? { error: p.error } : {}) });
    });

    const mind = createMindDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js', invoke: mockInvoke(log, okOutcome) });
    mind.start();

    await bus.emit('webhook.persona', {
      id: 'persona:avery:email:001' as any,
      source: 'persona-emulator',
      observed_at: '2026-05-25T12:00:00Z',
      occurred_at: '2026-05-25T12:00:00Z',
      identity_handles: [],
      payload: {},
    });
    await bus.whenDrained();

    expect(log).toHaveLength(1);
    expect(log[0]!.role).toBe('mind');
    expect(log[0]!.mcpServerKeys).toEqual(['digest-substrate', 'gmail-mcp']);
    expect(done).toEqual([{ exit_code: 0 }]);
  });

  it('ignores non-trigger events (e.g. tunnel.up)', async () => {
    const log: InvocationLog[] = [];
    const mind = createMindDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js', invoke: mockInvoke(log, okOutcome) });
    mind.start();

    await bus.emit('tunnel.up', { public_url: 'http://x' });
    await bus.whenDrained();
    expect(log).toHaveLength(0);
  });

  it('serializes invocations through the bus subscription', async () => {
    // Capture the start order; resolve slowly so two events queue up.
    const order: number[] = [];
    let nextId = 0;
    const invoke = async () => {
      const id = ++nextId;
      order.push(id);
      await new Promise((r) => setTimeout(r, 20));
      return okOutcome;
    };
    const mind = createMindDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js', invoke });
    mind.start();

    await Promise.all([
      bus.emit('webhook.persona', {
        id: 'p:1' as any,
        source: 'p',
        observed_at: 'x',
        occurred_at: 'x',
        identity_handles: [],
        payload: {},
      }),
      bus.emit('webhook.persona', {
        id: 'p:2' as any,
        source: 'p',
        observed_at: 'x',
        occurred_at: 'x',
        identity_handles: [],
        payload: {},
      }),
    ]);
    await bus.whenDrained();

    expect(order).toEqual([1, 2]);
  });

  it('reports non-zero exit and timeouts in the done event', async () => {
    const log: InvocationLog[] = [];
    const done: { exit_code: number; error?: string }[] = [];
    bus.on('mind.invocation.done', (p) => {
      done.push({ exit_code: p.exit_code, ...(p.error ? { error: p.error } : {}) });
    });

    const failingOutcome: ClaudeCodeOutcome = {
      ...okOutcome,
      exitCode: 137,
      timedOut: true,
      durationMs: 1500,
      finalMessage: null,
    };
    const mind = createMindDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js',
      invoke: mockInvoke(log, failingOutcome),
    });
    mind.start();

    await bus.emit('reminder.fired', {
      reminder_id: 'r1' as any,
      context: 'check',
      related_anchors: [],
      fires_at: 'x',
    });
    await bus.whenDrained();

    expect(done[0]?.exit_code).toBe(137);
    expect(done[0]?.error).toMatch(/timed out/);
  });
});

describe('diary dispatcher', () => {
  it('fires on schedule.diary_tick after mind queue is empty', async () => {
    const log: InvocationLog[] = [];

    const mind = createMindDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js', invoke: mockInvoke(log, okOutcome) });
    mind.start();

    const diary = createDiaryDispatcher(cfg, bus, db, mind, { substrateServerPath: '/tmp/x.js',
      invoke: mockInvoke(log, okOutcome),
    });
    diary.start();

    await bus.emit('schedule.diary_tick', { trigger_at: '2026-05-25T12:00:00Z' });
    await bus.whenDrained();

    expect(log.find((l) => l.role === 'diary')).toBeTruthy();
    const diaryLog = log.find((l) => l.role === 'diary')!;
    expect(diaryLog.mcpServerKeys).toEqual(['digest-substrate', 'gmail-mcp']);
  });

  it('waits for the mind queue to drain before composing', async () => {
    const order: string[] = [];
    let mindResolve: () => void = () => {};
    const mindPromise = new Promise<void>((r) => {
      mindResolve = r;
    });

    const mindInvoke = async (): Promise<ClaudeCodeOutcome> => {
      order.push('mind:start');
      await mindPromise;
      order.push('mind:end');
      return okOutcome;
    };
    const diaryInvoke = async (): Promise<ClaudeCodeOutcome> => {
      order.push('diary:start');
      return okOutcome;
    };

    const mind = createMindDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js', invoke: mindInvoke });
    mind.start();
    const diary = createDiaryDispatcher(cfg, bus, db, mind, { substrateServerPath: '/tmp/x.js', invoke: diaryInvoke });
    diary.start();

    // Kick off a mind invocation (it blocks).
    const mindEmit = bus.emit('webhook.persona', {
      id: 'p:1' as any,
      source: 'p',
      observed_at: 'x',
      occurred_at: 'x',
      identity_handles: [],
      payload: {},
    });

    // Then a diary tick.
    await new Promise((r) => setTimeout(r, 10));
    const diaryEmit = bus.emit('schedule.diary_tick', { trigger_at: '2026-05-25T12:00:00Z' });

    // Diary should NOT start until mind unblocks.
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(['mind:start']);

    mindResolve();
    // The emit promises resolved immediately (worker is decoupled); drain to
    // let the worker finish mind, advance the cursor, then process the diary
    // tick that was queued earlier.
    await mindEmit;
    await diaryEmit;
    await bus.whenDrained();

    expect(order).toEqual(['mind:start', 'mind:end', 'diary:start']);
  });

  // Note: the previous "drops a second diary tick if one is already in flight"
  // test depended on bus.emit awaiting subscribers inline so two emits could
  // race the diary's runOnce. The new bus serializes subscribers via a single
  // worker, so a second tick is always processed AFTER the first finishes —
  // the dispatcher-side dedup logic no longer fires under the bus's normal
  // throughput. If we ever add concurrent dispatchers, the test should come
  // back; for now, the invariant is enforced by the bus.
});

describe('cold-start dispatcher', () => {
  it('fires on profile.changed and uses cold-start MCP scope (no externals)', async () => {
    const log: InvocationLog[] = [];
    const done: number[] = [];
    bus.on('coldstart.invocation.done', (p) => {
      done.push(p.exit_code);
    });

    const cold = createColdStartDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js', invoke: mockInvoke(log, okOutcome) });
    cold.start();

    await bus.emit('profile.changed', {
      mtime: '2026-05-25T12:00:00Z',
      path: join(tmp, 'profile.md'),
    });
    await bus.whenDrained();

    expect(log).toHaveLength(1);
    expect(log[0]!.role).toBe('cold-start');
    expect(log[0]!.mcpServerKeys).toEqual(['digest-substrate']); // no externals
    expect(done).toEqual([0]);
  });

  // The previous "skips overlapping triggers (busy)" test depended on bus.emit
  // awaiting subscribers inline so two emits could race the cold-start dispatcher's
  // busy guard. The new bus serializes subscribers; back-to-back profile.changed
  // events are now processed strictly in sequence. Keep the dispatcher's busy guard
  // for defense in depth, but the test no longer exercises it under normal bus throughput.
});
