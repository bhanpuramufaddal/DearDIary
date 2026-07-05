import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { Bus } from '../bus.js';
import { createWebhookServer } from './server.js';
import type { AppConfig } from '@shared/types/config.js';

const T = '2026-05-25T12:00:00-07:00';
const now = () => T;

let tmp: string;
let db: Db;
let bus: Bus;

const baseConfig: AppConfig = {
  timezone: 'America/Los_Angeles',
  digest_dir: '/tmp',
  event_sources: [],
  mcp_servers: [],
  agent_mcp_access: { mind: [], diary: [], cold_start: [] },
  webhook: {
    public_url: 'http://localhost/webhook',
    bind_host: '127.0.0.1',
    bind_port: 0,
    tunnel: { kind: 'external' },
  },
  schedule: { diary_times: ['06:00'] },
  claude_code: { executable: 'claude', extra_flags: [] },
  model: {
    mind_agent: 'a',
    diary_agent: 'b',
    cold_start_agent: 'c',
    execution_agent: 'd',
  },
  api_key_env: 'ANTHROPIC_API_KEY',
  mcp: { cache_ttl_minutes: 5 },
  log_dir: '/tmp/logs',
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-webhook-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
  bus = new Bus(db, { now });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('webhook server', () => {
  it('serves /health for monitoring', async () => {
    const server = createWebhookServer(baseConfig, bus, { now });
    await server.fastify.ready();
    const res = await server.fastify.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    await server.close();
  });
});
