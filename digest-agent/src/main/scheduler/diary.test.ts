import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { Bus } from '../bus.js';
import { AdjustableClock } from '../clock.js';
import { createDiaryScheduler } from './diary.js';
import type { AppConfig } from '@shared/types/config.js';

const T0 = new Date('2026-05-25T15:00:00Z'); // 8am PDT

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
  schedule: { diary_times: ['09:00', '12:30'] },
  claude_code: { executable: 'claude', extra_flags: [] },
  model: {
    mind_agent: 'a',
    diary_agent: 'b',
    cold_start_agent: 'c',
    execution_agent: 'd',
  },
  api_key_env: 'X',
  mcp: { cache_ttl_minutes: 5 },
  log_dir: '/tmp',
};

let tmp: string;
let db: Db;
let bus: Bus;
let clock: AdjustableClock;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-diary-sched-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
  clock = new AdjustableClock(T0);
  bus = new Bus(db, { now: () => clock.now().toISOString() });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('diary scheduler', () => {
  it('arms for the earliest upcoming diary time in the principal tz', () => {
    const scheduler = createDiaryScheduler(baseConfig, bus, { clock });
    scheduler.start();
    // At 8am PDT with diary_times [09:00, 12:30], next-fire is 09:00 PDT = 16:00 UTC.
    expect(scheduler.nextFire()?.toISOString()).toBe('2026-05-25T16:00:00.000Z');
    scheduler.stop();
  });

  it('emits schedule.diary_tick when the clock reaches the next fire instant', async () => {
    const ticks: string[] = [];
    bus.on('schedule.diary_tick', (p) => {
      ticks.push(p.trigger_at);
    });

    const scheduler = createDiaryScheduler(baseConfig, bus, { clock });
    scheduler.start();

    // Advance to 09:00 PDT (16:00 UTC).
    await clock.advanceTo(new Date('2026-05-25T16:00:00Z'));
    expect(ticks).toEqual(['2026-05-25T16:00:00.000Z']);

    // After firing, scheduler re-arms for the next time (12:30 PDT = 19:30 UTC).
    expect(scheduler.nextFire()?.toISOString()).toBe('2026-05-25T19:30:00.000Z');

    scheduler.stop();
  });

  it('rolls into the next day after the last diary_time of the day has fired', () => {
    const lateConfig: AppConfig = {
      ...baseConfig,
      schedule: { diary_times: ['07:30'] }, // already passed today
    };
    const scheduler = createDiaryScheduler(lateConfig, bus, { clock });
    scheduler.start();
    // 07:30 PDT today (14:30 UTC) has passed; should be tomorrow.
    expect(scheduler.nextFire()?.toISOString()).toBe('2026-05-26T14:30:00.000Z');
    scheduler.stop();
  });

  it('does not arm when diary_times is empty', () => {
    const empty: AppConfig = { ...baseConfig, schedule: { diary_times: [] } };
    const scheduler = createDiaryScheduler(empty, bus, { clock });
    scheduler.start();
    expect(scheduler.nextFire()).toBeNull();
    scheduler.stop();
  });

  it('chains across many days when the clock jumps far forward (persona-clock scenario)', async () => {
    // Two diary_times per day; jump from May 1 00:00 PDT to May 31 00:00 PDT.
    // Expect 30 days × 2 fires = 60 ticks fired in a single advanceTo call.
    const personaConfig: AppConfig = {
      ...baseConfig,
      schedule: { diary_times: ['06:00', '21:00'] },
    };
    // Initialize the clock to start-of-window in UTC.
    const c2 = new AdjustableClock(new Date('2026-05-01T07:00:00Z')); // before 06:00 PDT today
    // Recreate bus + scheduler with this clock for isolation.
    const ticks: string[] = [];
    const bus2 = new Bus(db, { now: () => c2.now().toISOString() });
    bus2.on('schedule.diary_tick', (p) => {
      ticks.push(p.trigger_at);
    });
    const scheduler = createDiaryScheduler(personaConfig, bus2, { clock: c2 });
    scheduler.start();

    // Jump 30 days forward in one advance.
    await c2.advanceTo(new Date('2026-05-31T07:00:00Z'));
    expect(ticks.length).toBe(60);

    // Each timestamp should be on a distinct (day, slot) pair, all sorted ascending.
    for (let i = 1; i < ticks.length; i++) {
      expect(new Date(ticks[i]!).getTime()).toBeGreaterThan(new Date(ticks[i - 1]!).getTime());
    }
    scheduler.stop();
  });
});
