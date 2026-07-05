import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { Bus } from '../bus.js';
import { AdjustableClock } from '../clock.js';
import { makeNodesRepo } from '../db/nodes.js';
import { makeAnchorsRepo } from '../db/anchors.js';
import { makeRemindersRepo } from '../db/reminders.js';
import { createReminderScheduler } from './reminders.js';
import type { AnchorId } from '@shared/types/ids.js';

const T0 = new Date('2026-05-25T12:00:00Z');

let tmp: string;
let db: Db;
let bus: Bus;
let clock: AdjustableClock;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-reminder-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
  clock = new AdjustableClock(T0);
  bus = new Bus(db, { now: () => clock.now().toISOString() });

  // Seed an anchor so reminder_anchor_refs has a target if needed.
  const nodes = makeNodesRepo(db);
  const anchors = makeAnchorsRepo(db);
  nodes.insertNode('marcus_webb', 'anchor', T0.toISOString());
  anchors.createAnchor({
    id: 'marcus_webb',
    kind: 'person',
    identity_handles: [],
    slow: { content: 'x', precision: 0.5 },
    last_bumped: T0.toISOString(),
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('reminder scheduler', () => {
  it('fires a reminder when the clock reaches fires_at', async () => {
    const reminders = makeRemindersRepo(db);
    const firesAt = new Date(T0.getTime() + 5_000);
    reminders.createReminder({
      id: 'rem_1',
      fires_at: firesAt.toISOString(),
      context: "Marcus's silence past the window — check",
      set_by: 'mind_agent',
      set_at: T0.toISOString(),
      related_anchors: ['marcus_webb' as AnchorId],
    });

    const seen: { id: string; context: string }[] = [];
    bus.on('reminder.fired', (p) => {
      seen.push({ id: p.reminder_id, context: p.context });
    });

    const scheduler = createReminderScheduler(db, bus, { clock });
    scheduler.start();
    expect(seen).toEqual([]);

    await clock.advanceTo(firesAt);
    await bus.whenDrained();
    expect(seen).toEqual([
      { id: 'rem_1', context: "Marcus's silence past the window — check" },
    ]);

    const row = db.prepare('SELECT fired_at FROM reminders WHERE id = ?').get('rem_1') as {
      fired_at: string | null;
    };
    expect(row.fired_at).not.toBeNull();

    scheduler.stop();
  });

  it('fires reminders in fires_at order', async () => {
    const reminders = makeRemindersRepo(db);
    reminders.createReminder({
      id: 'late',
      fires_at: new Date(T0.getTime() + 10_000).toISOString(),
      context: 'late',
      set_by: 'mind_agent',
      set_at: T0.toISOString(),
      related_anchors: [],
    });
    reminders.createReminder({
      id: 'early',
      fires_at: new Date(T0.getTime() + 3_000).toISOString(),
      context: 'early',
      set_by: 'mind_agent',
      set_at: T0.toISOString(),
      related_anchors: [],
    });

    const order: string[] = [];
    bus.on('reminder.fired', (p) => {
      order.push(p.reminder_id);
    });

    const scheduler = createReminderScheduler(db, bus, { clock });
    scheduler.start();

    await clock.advanceTo(new Date(T0.getTime() + 11_000));
    await bus.whenDrained();
    expect(order).toEqual(['early', 'late']);
    scheduler.stop();
  });

  it('re-arms when mind.invocation.done fires (picks up new reminders)', async () => {
    const reminders = makeRemindersRepo(db);
    const seen: string[] = [];
    bus.on('reminder.fired', (p) => {
      seen.push(p.reminder_id);
    });

    const scheduler = createReminderScheduler(db, bus, { clock });
    scheduler.start();
    // No reminders yet — nothing scheduled.

    // Simulate a mind invocation that inserts a fresh reminder.
    reminders.createReminder({
      id: 'fresh',
      fires_at: new Date(T0.getTime() + 2_000).toISOString(),
      context: 'fresh',
      set_by: 'mind_agent',
      set_at: T0.toISOString(),
      related_anchors: [],
    });
    await bus.emit('mind.invocation.done', {
      invocation_id: 'inv_1',
      role: 'mind',
      exit_code: 0,
      duration_ms: 10,
    });
    await bus.whenDrained();

    await clock.advanceTo(new Date(T0.getTime() + 2_000));
    await bus.whenDrained();
    expect(seen).toEqual(['fresh']);
    scheduler.stop();
  });

  it('fires many reminders chained through one big advance (persona-clock scenario)', async () => {
    const reminders = makeRemindersRepo(db);
    // 30 reminders spread across the next 30 days, one per day at noon UTC.
    for (let i = 0; i < 30; i++) {
      const firesAt = new Date(T0.getTime() + (i + 1) * 86_400_000);
      reminders.createReminder({
        id: `rem_${i}`,
        fires_at: firesAt.toISOString(),
        context: `day ${i}`,
        set_by: 'mind_agent',
        set_at: T0.toISOString(),
        related_anchors: [],
      });
    }

    const order: string[] = [];
    bus.on('reminder.fired', (p) => {
      order.push(p.reminder_id);
    });

    const scheduler = createReminderScheduler(db, bus, { clock });
    scheduler.start();

    // One big jump 31 days forward.
    await clock.advanceTo(new Date(T0.getTime() + 31 * 86_400_000));
    await bus.whenDrained();

    expect(order).toHaveLength(30);
    // Fired in chronological order.
    for (let i = 0; i < 30; i++) {
      expect(order[i]).toBe(`rem_${i}`);
    }
    scheduler.stop();
  });
});
