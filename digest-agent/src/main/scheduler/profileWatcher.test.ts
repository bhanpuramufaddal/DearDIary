import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { Bus } from '../bus.js';
import { createProfileWatcher } from './profileWatcher.js';
import type { AppConfig } from '@shared/types/config.js';

let tmp: string;
let db: Db;
let bus: Bus;

const baseConfig = (): AppConfig => ({
  timezone: 'UTC',
  digest_dir: tmp,
  event_sources: [],
  mcp_servers: [],
  agent_mcp_access: { mind: [], diary: [], cold_start: [] },
  webhook: { public_url: 'x', bind_host: '127.0.0.1', bind_port: 0, tunnel: { kind: 'external' } },
  schedule: { diary_times: [] },
  claude_code: { executable: 'claude', extra_flags: [] },
  model: { mind_agent: 'a', diary_agent: 'b', cold_start_agent: 'c', execution_agent: 'd' },
  api_key_env: 'X',
  mcp: { cache_ttl_minutes: 5 },
  log_dir: tmp,
});

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-profile-watch-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
  bus = new Bus(db);
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

// fs.watch behavior is platform-dependent and event timing is real-clock. We
// keep these tests permissive: short debounce, real timers, accept reasonable
// delay before the emit lands.
describe('profile watcher', () => {
  it('emits profile.changed after a debounced edit', async () => {
    const profilePath = join(tmp, 'profile.md');
    writeFileSync(profilePath, 'initial content\n');

    const seen: string[] = [];
    bus.on('profile.changed', (p) => {
      seen.push(p.path);
    });

    const watcher = createProfileWatcher(baseConfig(), bus, { debounceMs: 50 });
    watcher.start();

    // Wait a tick so the watcher binds.
    await new Promise((r) => setTimeout(r, 100));

    // Burst of writes — debounce should coalesce them into a single emit.
    appendFileSync(profilePath, 'edit 1\n');
    appendFileSync(profilePath, 'edit 2\n');
    appendFileSync(profilePath, 'edit 3\n');

    // Wait for debounce + buffer.
    await new Promise((r) => setTimeout(r, 250));

    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(profilePath);

    watcher.stop();
  });

  it('does not emit when started against an existing file with no change', async () => {
    const profilePath = join(tmp, 'profile.md');
    writeFileSync(profilePath, 'unchanged\n');

    const seen: string[] = [];
    bus.on('profile.changed', () => {
      seen.push('x');
    });

    const watcher = createProfileWatcher(baseConfig(), bus, { debounceMs: 50 });
    watcher.start();
    await new Promise((r) => setTimeout(r, 200));

    expect(seen).toEqual([]);
    watcher.stop();
  });
});
