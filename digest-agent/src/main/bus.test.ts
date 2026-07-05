import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDatabase, type Db } from './db/index.js';
import { applyMigrations } from './db/migrate.js';
import { Bus } from './bus.js';
import type { SourceId } from '@shared/types/ids.js';
import { mkSourceId } from '@shared/types/ids.js';

const T = '2026-05-25T12:00:00-07:00';

let tmp: string;
let db: Db;
let nowCounter = 0;
const now = () => `2026-05-25T12:00:0${nowCounter++}-07:00`;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-bus-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
  nowCounter = 0;
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function samplePayload(sourceId: SourceId = mkSourceId('persona:avery:email:001')) {
  return {
    id: sourceId,
    source: 'persona-emulator',
    observed_at: T,
    occurred_at: T,
    identity_handles: ['Sarah Chen'],
    payload: { msg: 'hi' },
  };
}

describe('Bus.emit', () => {
  it('records the audit row synchronously and runs subscribers in a deferred microtask', async () => {
    const bus = new Bus(db, { now });
    const order: string[] = [];

    bus.on('webhook.persona', () => {
      // At handler time, the row must already exist with this id.
      const rows = db.prepare('SELECT id FROM events').all() as { id: number }[];
      expect(rows).toHaveLength(1);
      order.push('handler');
    });

    order.push('before-emit');
    await bus.emit('webhook.persona', samplePayload());
    // emit returned synchronously (its Promise is pre-resolved). The worker
    // microtask was already queued before our `await` continuation, so the
    // handler has run by the time `after-emit` is pushed.
    order.push('after-emit');
    await bus.whenDrained();
    order.push('after-drained');

    expect(order).toEqual(['before-emit', 'handler', 'after-emit', 'after-drained']);
  });

  it('delivers to matching subscribers and skips non-matching', async () => {
    const bus = new Bus(db, { now });
    const seen: string[] = [];

    bus.on('webhook.persona', () => {
      seen.push('persona');
    });
    bus.on('webhook.gmail', () => {
      seen.push('gmail');
    });
    bus.on('*', () => {
      seen.push('*');
    });

    await bus.emit('webhook.persona', samplePayload());
    await bus.whenDrained();

    expect(seen).toEqual(['persona', '*']);
  });

  it('runs subscribers in registration order, awaiting each', async () => {
    const bus = new Bus(db, { now });
    const order: string[] = [];

    bus.on('webhook.persona', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('first');
    });
    bus.on('webhook.persona', () => {
      order.push('second');
    });
    bus.on('webhook.persona', async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('third');
    });

    await bus.emit('webhook.persona', samplePayload());
    await bus.whenDrained();

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('handlers receive the published event id and kind in meta', async () => {
    const bus = new Bus(db, { now });
    let observedId = 0;
    let observedKind = '';

    bus.on('webhook.persona', (_payload, meta) => {
      observedId = meta.id;
      observedKind = meta.kind;
    });

    await bus.emit('webhook.persona', samplePayload());
    await bus.whenDrained();

    expect(observedId).toBeGreaterThan(0);
    expect(observedKind).toBe('webhook.persona');
  });

  it('drains queued events in FIFO order', async () => {
    const bus = new Bus(db, { now });
    const seen: number[] = [];

    bus.on('webhook.persona', (_p, meta) => {
      seen.push(meta.id);
    });

    await bus.emit('webhook.persona', samplePayload());
    await bus.emit('webhook.persona', samplePayload(mkSourceId('persona:avery:email:002')));
    await bus.emit('webhook.persona', samplePayload(mkSourceId('persona:avery:email:003')));
    await bus.whenDrained();

    expect(seen).toEqual([1, 2, 3]);
  });

  it('handles re-entrant emits via the queue, no recursion', async () => {
    // A handler emits a new event; the new event gets processed AFTER the
    // current one finishes through all subscribers.
    const bus = new Bus(db, { now });
    const order: string[] = [];

    bus.on('webhook.persona', async () => {
      order.push('a');
      void bus.emit('webhook.gmail', samplePayload());
      // emit returns immediately; the gmail handler runs after we return.
    });
    bus.on('webhook.gmail', () => {
      order.push('b');
    });

    await bus.emit('webhook.persona', samplePayload());
    await bus.whenDrained();

    expect(order).toEqual(['a', 'b']);
  });
});

describe('Bus durable subscribers', () => {
  it('require a name', () => {
    const bus = new Bus(db, { now });
    expect(() => bus.on('webhook.persona', () => {}, { durable: true })).toThrow(/name/);
  });

  it('reject duplicate names', () => {
    const bus = new Bus(db, { now });
    bus.on('webhook.persona', () => {}, { durable: true, name: 'mind' });
    expect(() =>
      bus.on('webhook.persona', () => {}, { durable: true, name: 'mind' }),
    ).toThrow(/already registered/);
  });

  it('advance cursor after each successful emit', async () => {
    const bus = new Bus(db, { now });
    bus.on('webhook.persona', () => {}, { durable: true, name: 'mind' });

    await bus.emit('webhook.persona', samplePayload());
    await bus.emit('webhook.persona', samplePayload(mkSourceId('persona:avery:email:002')));
    await bus.emit('webhook.persona', samplePayload(mkSourceId('persona:avery:email:003')));
    await bus.whenDrained();

    const row = db
      .prepare('SELECT last_event_id FROM event_subscriber_cursors WHERE subscriber_name = ?')
      .get('mind') as { last_event_id: number };
    expect(row.last_event_id).toBe(3);
  });

  it('do not advance cursor if handler throws', async () => {
    // In the worker model, emit doesn't reject — the error is logged and the
    // cursor stays at the last successful event. Replay on next boot retries.
    const bus = new Bus(db, { now });
    let calls = 0;
    bus.on(
      'webhook.persona',
      () => {
        calls++;
        if (calls === 2) throw new Error('boom');
      },
      { durable: true, name: 'mind' },
    );

    await bus.emit('webhook.persona', samplePayload());
    await bus.emit('webhook.persona', samplePayload(mkSourceId('persona:avery:email:002')));
    await bus.whenDrained();

    const row = db
      .prepare('SELECT last_event_id FROM event_subscriber_cursors WHERE subscriber_name = ?')
      .get('mind') as { last_event_id: number };
    expect(row.last_event_id).toBe(1); // not 2 — second emit's handler threw
  });
});

describe('Bus.replayDurableSubscribers', () => {
  it('re-delivers events past cursor on boot', async () => {
    // Boot 1: emit two events, durable subscriber records both.
    const bus1 = new Bus(db, { now });
    const received1: number[] = [];
    bus1.on(
      'webhook.persona',
      (_p, meta) => {
        received1.push(meta.id);
      },
      { durable: true, name: 'mind' },
    );
    await bus1.emit('webhook.persona', samplePayload());
    await bus1.emit('webhook.persona', samplePayload(mkSourceId('persona:avery:email:002')));
    await bus1.whenDrained();
    expect(received1).toEqual([1, 2]);

    // Boot 2: insert one MORE event via raw SQL (simulating events captured
    // through some other path between boots).
    db.prepare(
      'INSERT INTO events (kind, payload, published_at) VALUES (?, ?, ?)',
    ).run('webhook.persona', JSON.stringify(samplePayload()), T);

    const bus2 = new Bus(db, { now });
    const received2: number[] = [];
    bus2.on(
      'webhook.persona',
      (_p, meta) => {
        received2.push(meta.id);
      },
      { durable: true, name: 'mind' },
    );

    await bus2.replayDurableSubscribers();
    expect(received2).toEqual([3]); // only the unseen event re-delivered

    // Cursor now at 3.
    const row = db
      .prepare('SELECT last_event_id FROM event_subscriber_cursors WHERE subscriber_name = ?')
      .get('mind') as { last_event_id: number };
    expect(row.last_event_id).toBe(3);
  });

  it('non-durable subscribers do not replay', async () => {
    const bus1 = new Bus(db, { now });
    bus1.on('webhook.persona', () => {});
    await bus1.emit('webhook.persona', samplePayload());
    await bus1.whenDrained();

    const bus2 = new Bus(db, { now });
    const seen: number[] = [];
    bus2.on('webhook.persona', (_p, meta) => {
      seen.push(meta.id);
    });
    await bus2.replayDurableSubscribers();
    expect(seen).toEqual([]); // not durable → no replay
  });

  it("filters replay by subscriber's kind", async () => {
    const bus1 = new Bus(db, { now });
    await bus1.emit('webhook.persona', samplePayload());
    await bus1.emit('reminder.fired', {
      reminder_id: 'r1' as never,
      context: 'check Marcus',
      related_anchors: [],
      fires_at: T,
    });
    await bus1.whenDrained();

    const bus2 = new Bus(db, { now });
    const personaSeen: number[] = [];
    bus2.on(
      'webhook.persona',
      (_p, meta) => {
        personaSeen.push(meta.id);
      },
      { durable: true, name: 'mind' },
    );
    await bus2.replayDurableSubscribers();

    expect(personaSeen).toEqual([1]); // reminder.fired skipped
  });
});

describe('Bus durable wildcard subscriber', () => {
  it('replays every event kind past the cursor on boot', async () => {
    // Boot 1: emit several different kinds; durable * subscriber sees all.
    const bus1 = new Bus(db, { now });
    const seen1: { id: number; kind: string }[] = [];
    bus1.on(
      '*',
      (_p, meta) => {
        seen1.push({ id: meta.id, kind: meta.kind });
      },
      { durable: true, name: 'audit' },
    );
    await bus1.emit('webhook.persona', samplePayload());
    await bus1.emit('reminder.fired', {
      reminder_id: 'r1' as never,
      context: 'check',
      related_anchors: [],
      fires_at: T,
    });
    await bus1.whenDrained();
    expect(seen1.map((s) => s.kind)).toEqual(['webhook.persona', 'reminder.fired']);

    // Insert an event directly while the bus is "off" (simulating events
    // captured by some other path between boots).
    db.prepare(
      'INSERT INTO events (kind, payload, published_at) VALUES (?, ?, ?)',
    ).run('schedule.diary_tick', JSON.stringify({ trigger_at: T }), T);

    // Boot 2: same durable name, fresh handler; replay should deliver the new row only.
    const bus2 = new Bus(db, { now });
    const seen2: { id: number; kind: string }[] = [];
    bus2.on(
      '*',
      (_p, meta) => {
        seen2.push({ id: meta.id, kind: meta.kind });
      },
      { durable: true, name: 'audit' },
    );
    await bus2.replayDurableSubscribers();
    expect(seen2.map((s) => s.kind)).toEqual(['schedule.diary_tick']);
  });
});
