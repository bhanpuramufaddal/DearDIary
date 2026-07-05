/**
 * Execution dispatcher tests — verify task.fired drives a Claude Code
 * subprocess scoped to external MCPs only, that success/failure outcomes
 * land on the bus correctly, and that successful tasks flip the component
 * status to 'acted'.
 *
 * The actual `claude` CLI is mocked via the invoke injection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { Bus } from '../bus.js';
import type { ClaudeCodeOutcome } from '../claudeCode.js';
import { createExecutionDispatcher } from './execution.js';
import { makeNodesRepo } from '../db/nodes.js';
import { makeAnchorsRepo } from '../db/anchors.js';
import { makeDiaryRepo } from '../db/diary.js';
import type { AppConfig } from '@shared/types/config.js';
import type {
  AnchorId,
  DiaryComponentId,
  TaskId,
} from '@shared/types/ids.js';

const T0 = '2026-05-25T12:00:00Z';

let tmp: string;
let db: Db;
let bus: Bus;
let cfg: AppConfig;

function makeConfig(): AppConfig {
  return {
    timezone: 'UTC',
    digest_dir: tmp,
    event_sources: [],
    mcp_servers: [
      { id: 'gmail-mcp', command: 'uvx gmail-mcp' },
      { id: 'gcal-mcp', command: 'uvx gcal-mcp' },
    ],
    agent_mcp_access: { mind: [], diary: [], cold_start: [] },
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

function seedComponent(): string {
  const nodes = makeNodesRepo(db);
  const anchors = makeAnchorsRepo(db);
  const diary = makeDiaryRepo(db);
  nodes.insertNode('marcus_webb', 'anchor', T0);
  anchors.createAnchor({
    id: 'marcus_webb',
    kind: 'person',
    identity_handles: [],
    slow: { content: 'cofounder', precision: 0.5 },
    last_bumped: T0,
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
          content: { to: ['marcus@example.com'], subject: 'cap table', body: 'hi' },
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
  return 'cmp_send';
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-exec-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));

  // Seed prompts into the DB — loadSystemPrompt now reads from DB.
  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO prompts (name, kind, title, content, source, created_at, updated_at)
    VALUES (?, 'agent', ?, ?, 'bundled', ?, ?)`).run('disposition', 'disposition', 'shared disposition', now, now);
  db.prepare(`INSERT OR REPLACE INTO prompts (name, kind, title, content, source, created_at, updated_at)
    VALUES (?, 'agent', ?, ?, 'bundled', ?, ?)`).run('execution-agent', 'execution-agent', 'you are the execution agent', now, now);

  bus = new Bus(db);
  cfg = makeConfig();
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

const ok = (final: unknown): ClaudeCodeOutcome => ({
  exitCode: 0,
  signal: null,
  durationMs: 12,
  stdout: '',
  stderr: '',
  finalMessage: final,
  timedOut: false,
});

const nonZero: ClaudeCodeOutcome = {
  exitCode: 2,
  signal: null,
  durationMs: 9,
  stdout: '',
  stderr: 'boom',
  finalMessage: null,
  timedOut: false,
};

function fireTask(componentId: string): Promise<void> {
  return bus.emit('task.fired', {
    task_id: 'tsk_x' as TaskId,
    component_id: componentId as DiaryComponentId,
    diary_date: '2026-05-25',
    action: { id: 'send', kind: 'send_email' },
    principal_input: null,
    context_pointers: { anchor_ids: ['marcus_webb' as AnchorId] },
  });
}

/**
 * Returns a tracker that must be installed BEFORE the task is fired (the
 * execution dispatcher's invoke is fire-and-forget, so the outcome event can
 * land before we get a chance to subscribe). The tracker's `done` promise
 * resolves on the first task.completed or task.failed event.
 */
function trackOutcome(expected = 1): {
  done: Promise<void>;
  state: {
    completed: number;
    failed: number;
    lastOutcome?: Record<string, unknown> | undefined;
    lastError?: string | undefined;
  };
} {
  const state = {
    completed: 0,
    failed: 0,
    lastOutcome: undefined as Record<string, unknown> | undefined,
    lastError: undefined as string | undefined,
  };
  let resolved = false;
  let resolver: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolver = (): void => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    setTimeout(resolver, 1500); // safety
  });
  let total = 0;
  bus.on('task.completed', (p) => {
    state.completed++;
    state.lastOutcome = p.outcome;
    if (++total >= expected) resolver();
  });
  bus.on('task.failed', (p) => {
    state.failed++;
    state.lastError = p.error;
    if (++total >= expected) resolver();
  });
  return { done, state };
}

describe('execution dispatcher', () => {
  it('spawns claude code on task.fired and emits task.completed on success', async () => {
    const componentId = seedComponent();
    const invocations: { mcpServerKeys: string[]; userPrompt: string }[] = [];

    const exec = createExecutionDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js',
      invoke: async (opts) => {
        invocations.push({
          mcpServerKeys: Object.keys(opts.mcpConfig.mcpServers).sort(),
          userPrompt: opts.userPrompt,
        });
        return ok({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                task_id: 'tsk_x',
                status: 'completed',
                summary: 'sent',
                evidence: { mcp_tool: 'gmail-mcp/send', result: { id: 'msg_1' } },
              }),
            },
          ],
        });
      },
    });
    exec.start();
    const tracker = trackOutcome();
    await fireTask(componentId);
    await tracker.done;
    const result = tracker.state;

    expect(invocations).toHaveLength(1);
    // Execution role: no substrate MCP, every external MCP configured.
    expect(invocations[0]!.mcpServerKeys).toEqual(['gcal-mcp', 'gmail-mcp']);
    // The user prompt embeds the component content so the agent can act without substrate reads.
    expect(invocations[0]!.userPrompt).toContain('component_content');
    expect(invocations[0]!.userPrompt).toContain('cap table');

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.lastOutcome).toEqual({
      mcp_tool: 'gmail-mcp/send',
      result: { id: 'msg_1' },
    });

    // Component status flipped to 'acted'.
    const row = db
      .prepare('SELECT status FROM diary_components WHERE id = ?')
      .get(componentId) as { status: string };
    expect(row.status).toBe('acted');
  });

  it('emits task.failed when claude exits non-zero', async () => {
    const componentId = seedComponent();
    const exec = createExecutionDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js',
      invoke: async () => nonZero,
    });
    exec.start();
    const tracker = trackOutcome();
    await fireTask(componentId);
    await tracker.done;
    const result = tracker.state;

    expect(result.completed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.lastError).toMatch(/exited 2/);

    // Status remains 'open' on failure.
    const row = db
      .prepare('SELECT status FROM diary_components WHERE id = ?')
      .get(componentId) as { status: string };
    expect(row.status).toBe('open');
  });

  it("emits task.failed when the agent reports status='failed' in its final message", async () => {
    const componentId = seedComponent();
    const exec = createExecutionDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js',
      invoke: async () =>
        ok({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                task_id: 'tsk_x',
                status: 'failed',
                summary: 'auth expired',
                error: 'gmail auth expired',
              }),
            },
          ],
        }),
    });
    exec.start();
    const tracker = trackOutcome();
    await fireTask(componentId);
    await tracker.done;
    const result = tracker.state;

    expect(result.failed).toBe(1);
    expect(result.lastError).toBe('gmail auth expired');
  });

  it('runs concurrent tasks in parallel rather than serializing them', async () => {
    const componentId = seedComponent();
    let active = 0;
    let maxActive = 0;
    const exec = createExecutionDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js',
      invoke: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 30));
        active--;
        return ok({
          content: [
            { type: 'text', text: JSON.stringify({ status: 'completed', summary: 'ok' }) },
          ],
        });
      },
    });
    exec.start();

    // Fire two tasks immediately; they should execute concurrently.
    await Promise.all([fireTask(componentId), fireTask(componentId)]);
    // Wait for both to settle.
    await new Promise((r) => setTimeout(r, 120));
    expect(maxActive).toBe(2);
  });

  it('parses an outcome wrapped in a ```json fenced code block', async () => {
    const componentId = seedComponent();
    const exec = createExecutionDispatcher(cfg, bus, db, { substrateServerPath: '/tmp/x.js',
      invoke: async () =>
        ok({
          content: [
            {
              type: 'text',
              text: `Here's the result:\n\n\`\`\`json\n${JSON.stringify({
                task_id: 'tsk_x',
                status: 'completed',
                summary: 'fenced',
              })}\n\`\`\``,
            },
          ],
        }),
    });
    exec.start();
    const tracker = trackOutcome();
    await fireTask(componentId);
    await tracker.done;
    expect(tracker.state.completed).toBe(1);
  });

  it('blocked mode skips the agent entirely — no spawn, no completion, no status flip', async () => {
    const componentId = seedComponent();
    let invokeCount = 0;
    const exec = createExecutionDispatcher(cfg, bus, db, {
      substrateServerPath: '/tmp/x.js',
      blocked: true,
      // If `invoke` were called (it shouldn't be), this would bump the counter.
      invoke: async () => {
        invokeCount++;
        return ok({});
      },
    });

    let outcomes = 0;
    bus.on('task.completed', () => {
      outcomes++;
    });
    bus.on('task.failed', () => {
      outcomes++;
    });

    exec.start();
    await fireTask(componentId);
    // Give any erroneous async runOne time to complete (it shouldn't, but
    // we want to fail loudly if it does).
    await new Promise((r) => setTimeout(r, 50));

    expect(invokeCount).toBe(0);
    expect(outcomes).toBe(0);

    const row = db
      .prepare('SELECT status FROM diary_components WHERE id = ?')
      .get(componentId) as { status: string };
    expect(row.status).toBe('open');
  });
});
