import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { Bus } from '../bus.js';
import { makePendingEventsRepo } from '../db/pendingEvents.js';
import { createEventRelay } from './eventRelay.js';

let tmp: string;
let db: Db;
let bus: Bus;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-relay-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
  bus = new Bus(db);
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('event relay', () => {
  it('drains pending_bus_events and emits on the bus', async () => {
    const pending = makePendingEventsRepo(db);
    const seen: { kind: string; payload: unknown }[] = [];
    bus.on('*', (payload, meta) => {
      seen.push({ kind: meta.kind, payload });
    });

    pending.enqueue(
      'diary.comment.added',
      { component_id: 'cmp_1', text: 'hello', created_at: 'T' },
      null,
      'T',
    );
    pending.enqueue(
      'diary.note.added',
      { diary_date: '2026-05-25', text: 'note', created_at: 'T' },
      null,
      'T',
    );
    expect(pending.count()).toBe(2);

    const relay = createEventRelay(db, bus, { intervalMs: 10 });
    relay.start();
    const drained = await relay.drainNow();
    await bus.whenDrained();
    relay.stop();

    expect(drained).toBe(2);
    expect(pending.count()).toBe(0);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.kind).toBe('diary.comment.added');
    expect(seen[1]!.kind).toBe('diary.note.added');
  });

  it('drops malformed rows with unknown kinds', async () => {
    const pending = makePendingEventsRepo(db);
    pending.enqueue('not.a.real.kind', { x: 1 }, null, 'T');
    pending.enqueue('diary.note.added', { diary_date: 'd', text: 't', created_at: 'T' }, null, 'T');

    const seen: string[] = [];
    bus.on('*', (_p, meta) => {
      seen.push(meta.kind);
    });

    const relay = createEventRelay(db, bus, { intervalMs: 10 });
    await relay.drainNow();
    await bus.whenDrained();
    relay.stop();

    expect(pending.count()).toBe(0); // both rows deleted
    expect(seen).toEqual(['diary.note.added']); // only the valid one emitted
  });

  it('survives a subscriber error and continues draining', async () => {
    const pending = makePendingEventsRepo(db);
    bus.on('diary.comment.added', () => {
      throw new Error('subscriber boom');
    });
    pending.enqueue('diary.comment.added', { component_id: 'x', text: 't', created_at: 'T' }, null, 'T');
    pending.enqueue('diary.note.added', { diary_date: 'd', text: 't', created_at: 'T' }, null, 'T');

    const relay = createEventRelay(db, bus, { intervalMs: 10 });
    await relay.drainNow();
    await bus.whenDrained();
    relay.stop();

    // Both rows deleted even though the first subscriber threw.
    expect(pending.count()).toBe(0);
  });

  it('the started timer drains repeatedly', async () => {
    const pending = makePendingEventsRepo(db);
    const seen: string[] = [];
    bus.on('*', (_p, meta) => {
      seen.push(meta.kind);
    });

    const relay = createEventRelay(db, bus, { intervalMs: 20 });
    relay.start();

    pending.enqueue('diary.note.added', { diary_date: 'd', text: 'one', created_at: 'T' }, null, 'T');
    await new Promise((r) => setTimeout(r, 60));
    pending.enqueue('diary.note.added', { diary_date: 'd', text: 'two', created_at: 'T' }, null, 'T');
    await new Promise((r) => setTimeout(r, 60));

    relay.stop();
    expect(seen).toEqual(['diary.note.added', 'diary.note.added']);
  });
});
