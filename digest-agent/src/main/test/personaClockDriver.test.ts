import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { Bus } from '../bus.js';
import { AdjustableClock } from '../clock.js';
import { createPersonaClockDriver } from './personaClockDriver.js';

let tmp: string;
let db: Db;
let bus: Bus;
let clock: AdjustableClock;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-persona-clock-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
  clock = new AdjustableClock(new Date('2026-05-01T00:00:00Z'));
  bus = new Bus(db, { now: () => clock.now().toISOString() });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function mindDone(opts: {
  triggering?: { kind: string; source_id?: string; occurred_at?: string };
}) {
  return {
    invocation_id: 'inv_test',
    role: 'mind' as const,
    exit_code: 0,
    duration_ms: 10,
    ...(opts.triggering ? { triggering: opts.triggering } : {}),
  };
}

describe('persona-clock driver (mind-anchored)', () => {
  it("advances the clock to the triggering webhook's occurred_at when mind finishes", async () => {
    createPersonaClockDriver(bus, clock).start();
    expect(clock.now().toISOString()).toBe('2026-05-01T00:00:00.000Z');

    await bus.emit(
      'mind.invocation.done',
      mindDone({ triggering: { kind: 'webhook.persona', occurred_at: '2026-05-15T12:30:00Z' } }),
    );
    await bus.whenDrained();
    expect(clock.now().toISOString()).toBe('2026-05-15T12:30:00.000Z');
  });

  it('does not rewind on out-of-order events (monotonicity)', async () => {
    createPersonaClockDriver(bus, clock).start();
    await bus.emit(
      'mind.invocation.done',
      mindDone({ triggering: { kind: 'webhook.persona', occurred_at: '2026-05-15T12:00:00Z' } }),
    );
    await bus.whenDrained();
    await bus.emit(
      'mind.invocation.done',
      mindDone({ triggering: { kind: 'webhook.persona', occurred_at: '2026-05-10T12:00:00Z' } }),
    );
    await bus.whenDrained();
    expect(clock.now().toISOString()).toBe('2026-05-15T12:00:00.000Z');
  });

  it('also tracks gmail / gcal triggering kinds', async () => {
    createPersonaClockDriver(bus, clock).start();
    await bus.emit(
      'mind.invocation.done',
      mindDone({ triggering: { kind: 'webhook.gmail', occurred_at: '2026-05-05T10:00:00Z' } }),
    );
    await bus.whenDrained();
    expect(clock.now().toISOString()).toBe('2026-05-05T10:00:00.000Z');
    await bus.emit(
      'mind.invocation.done',
      mindDone({ triggering: { kind: 'webhook.gcal', occurred_at: '2026-05-07T14:00:00Z' } }),
    );
    await bus.whenDrained();
    expect(clock.now().toISOString()).toBe('2026-05-07T14:00:00.000Z');
  });

  it('ignores invocations triggered by non-webhook kinds', async () => {
    createPersonaClockDriver(bus, clock).start();
    await bus.emit(
      'mind.invocation.done',
      mindDone({
        triggering: { kind: 'reminder.fired', occurred_at: '2026-06-01T00:00:00Z' },
      }),
    );
    await bus.whenDrained();
    expect(clock.now().toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('ignores malformed occurred_at without crashing', async () => {
    createPersonaClockDriver(bus, clock).start();
    await bus.emit(
      'mind.invocation.done',
      mindDone({ triggering: { kind: 'webhook.persona', occurred_at: 'not-a-date' } }),
    );
    await bus.whenDrained();
    expect(clock.now().toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('is a no-op when triggering field is absent', async () => {
    createPersonaClockDriver(bus, clock).start();
    await bus.emit('mind.invocation.done', mindDone({}));
    await bus.whenDrained();
    expect(clock.now().toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});
