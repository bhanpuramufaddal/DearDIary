import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Bus } from '../bus.js';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import {
  createPersonaEmulator,
  parseRate,
  readPersonaTimeline,
  resolvePersonaDbPath,
  toWebhookEvent,
  type PersonaRow,
} from './personaEmulator.js';

let tmp: string;
let db: Db;
let bus: Bus;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-pe-test-'));
  db = openDatabase(join(tmp, 'digest.db'));
  applyMigrations(db, join(process.cwd(), 'src/main/db/migrations'));
  bus = new Bus(db, { now: () => '2026-05-25T00:00:00Z' });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Build a persona-shaped sqlite DB with just enough columns for the reader. */
function makePersonaDb(path: string): void {
  const pdb = new Database(path);
  pdb.exec(`
    CREATE TABLE emails (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT,
      from_addr TEXT NOT NULL,
      to_addrs_json TEXT NOT NULL,
      cc_addrs_json TEXT,
      subject TEXT NOT NULL,
      date_iso TEXT NOT NULL,
      in_reply_to TEXT,
      body TEXT NOT NULL
    );
    CREATE TABLE calendar_ops (
      op_id INTEGER PRIMARY KEY,
      ts_iso TEXT NOT NULL,
      op TEXT NOT NULL,
      event_id TEXT NOT NULL,
      source TEXT NOT NULL,
      linked_message_id TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE notes (
      note_id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      created_iso TEXT NOT NULL,
      updated_iso TEXT
    );
  `);
  pdb.prepare(
    `INSERT INTO emails (message_id, from_addr, to_addrs_json, cc_addrs_json, subject, date_iso, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'msg_001',
    'renee@halberd.com',
    JSON.stringify(['avery@startup.com']),
    JSON.stringify(['cfo@startup.com']),
    'cap table',
    '2026-04-24T07:00:00-07:00',
    'hi avery',
  );
  pdb.prepare(
    `INSERT INTO calendar_ops (op_id, ts_iso, op, event_id, source, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    1,
    '2026-04-24T08:00:00-07:00',
    'add_event',
    'evt_xyz',
    'direct',
    JSON.stringify({ start_iso: '2026-04-25T09:00', title: 'Standup' }),
  );
  pdb.prepare(
    `INSERT INTO notes (note_id, filename, title, body, created_iso)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    'note_001',
    '2026-04-24-musings.md',
    'Musings',
    'a stray thought',
    '2026-04-24T06:00:00-07:00',
  );
  pdb.close();
}

describe('parseRate', () => {
  it('parses N/sec into ms intervals', () => {
    expect(parseRate('5/sec')).toBe(200);
    expect(parseRate('1/sec')).toBe(1000);
    expect(parseRate('10/sec')).toBe(100);
  });
  it('treats burst as zero delay', () => {
    expect(parseRate('burst')).toBe(0);
  });
  it('throws on bad units', () => {
    expect(() => parseRate('5/min')).toThrow(/<N>\/sec/);
  });
  it('throws on non-positive counts', () => {
    expect(() => parseRate('0/sec')).toThrow(/positive/);
    expect(() => parseRate('-3/sec')).toThrow(/positive/);
  });
  it('throws on non-numeric counts', () => {
    expect(() => parseRate('fast/sec')).toThrow(/positive number/);
  });
});

describe('resolvePersonaDbPath', () => {
  it('returns the sibling-relative path when the file exists', () => {
    const cwd = join(tmp, 'digest-agent');
    const dbDir = join(tmp, 'data', 'personas', 'avery_chen');
    require('node:fs').mkdirSync(cwd, { recursive: true });
    require('node:fs').mkdirSync(dbDir, { recursive: true });
    require('node:fs').writeFileSync(join(dbDir, 'persona.db'), '');
    expect(resolvePersonaDbPath('avery_chen', cwd)).toBe(
      join(dbDir, 'persona.db'),
    );
  });
  it('throws loudly when the file is missing', () => {
    expect(() => resolvePersonaDbPath('ghost_persona', tmp)).toThrow(
      /persona DB not found/,
    );
  });
});

describe('readPersonaTimeline', () => {
  it('merges emails, calendar_ops, notes in occurred_at order', () => {
    const path = join(tmp, 'persona.db');
    makePersonaDb(path);
    const t = readPersonaTimeline(path);
    expect(t.map((r) => `${r.kind}:${r.occurred_at}`)).toEqual([
      'note:2026-04-24T06:00:00-07:00',
      'email:2026-04-24T07:00:00-07:00',
      'calendar_event:2026-04-24T08:00:00-07:00',
    ]);
  });
});

describe('toWebhookEvent', () => {
  const now = () => '2026-05-25T00:00:00Z';

  it('converts an email row, dropping x_synth_*', () => {
    const pr: PersonaRow = {
      occurred_at: '2026-04-24T07:00:00-07:00',
      kind: 'email',
      row: {
        message_id: 'msg_1',
        from_addr: 'a@x.com',
        to_addrs_json: '["b@x.com","c@x.com"]',
        cc_addrs_json: '["d@x.com"]',
        subject: 's',
        body: 'b',
        in_reply_to: null,
        thread_id: 't_1',
        x_synth_storyline: 'series_a',
      },
    };
    const ev = toWebhookEvent('avery_chen', pr, { now });
    expect(ev.id).toBe('persona:avery_chen:email:msg_1');
    expect(ev.source).toBe('persona-emulator');
    expect(ev.identity_handles).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
    expect(ev.payload).toEqual({
      type: 'email',
      persona: 'avery_chen',
      data: {
        from: 'a@x.com',
        to: ['b@x.com', 'c@x.com'],
        cc: ['d@x.com'],
        subject: 's',
        body: 'b',
        in_reply_to: null,
        thread_id: 't_1',
      },
    });
  });

  it('converts a calendar_op with calop: prefix', () => {
    const pr: PersonaRow = {
      occurred_at: '2026-04-24T08:00:00-07:00',
      kind: 'calendar_event',
      row: {
        op_id: 42,
        op: 'add_event',
        event_id: 'evt_x',
        payload_json: '{"start_iso":"2026-04-25T09:00","title":"Standup"}',
        linked_message_id: null,
      },
    };
    const ev = toWebhookEvent('avery_chen', pr, { now });
    expect(ev.id).toBe('persona:avery_chen:calendar_event:calop:42');
    expect(ev.payload).toMatchObject({
      type: 'calendar_event',
      data: { op: 'add_event', event_id: 'evt_x', payload: { title: 'Standup' } },
    });
  });

  it('converts a note', () => {
    const pr: PersonaRow = {
      occurred_at: '2026-04-24T06:00:00-07:00',
      kind: 'note',
      row: {
        note_id: 'note_1',
        filename: '2026-04-24-x.md',
        title: 'T',
        body: 'B',
      },
    };
    const ev = toWebhookEvent('avery_chen', pr, { now });
    expect(ev.id).toBe('persona:avery_chen:note:note_1');
    expect(ev.payload).toMatchObject({
      type: 'note',
      data: { filename: '2026-04-24-x.md', title: 'T', body: 'B' },
    });
  });

  it('treats cc_addrs_json="null" (persona-gen idiom for no CC) as empty', () => {
    const pr: PersonaRow = {
      occurred_at: '2026-04-24T07:00:00-07:00',
      kind: 'email',
      row: {
        message_id: 'msg_no_cc',
        from_addr: 'a@x.com',
        to_addrs_json: '["b@x.com"]',
        cc_addrs_json: 'null',
        subject: 's',
        body: 'b',
        in_reply_to: null,
        thread_id: null,
      },
    };
    const ev = toWebhookEvent('avery_chen', pr, { now });
    expect(ev.identity_handles).toEqual(['a@x.com', 'b@x.com']);
    expect((ev.payload as Record<string, unknown>)['data']).toMatchObject({
      cc: [],
    });
  });

  it('treats empty-string cc_addrs_json as empty', () => {
    const pr: PersonaRow = {
      occurred_at: 'T',
      kind: 'email',
      row: {
        message_id: 'msg_empty_cc',
        from_addr: 'a@x.com',
        to_addrs_json: '["b@x.com"]',
        cc_addrs_json: '',
        subject: 's',
        body: 'b',
      },
    };
    const ev = toWebhookEvent('avery_chen', pr, { now });
    expect((ev.payload as Record<string, unknown>)['data']).toMatchObject({ cc: [] });
  });

  it('throws on cc_addrs_json that does not parse to null or array', () => {
    const pr: PersonaRow = {
      occurred_at: 'T',
      kind: 'email',
      row: {
        message_id: 'm',
        from_addr: 'a@x.com',
        to_addrs_json: '["b@x.com"]',
        cc_addrs_json: '"oops, a bare string"',
        subject: 's',
        body: 'b',
      },
    };
    expect(() => toWebhookEvent('avery_chen', pr, { now })).toThrow(
      /JSON did not parse to an array/,
    );
  });

  it('applies idPrefix when provided', () => {
    const pr: PersonaRow = {
      occurred_at: 'T',
      kind: 'note',
      row: { note_id: 'note_1', filename: 'f', body: 'B' },
    };
    const ev = toWebhookEvent('avery_chen', pr, { now, idPrefix: 'run42' });
    expect(ev.id).toBe('persona:avery_chen:note:run42:note_1');
  });
});

describe('createPersonaEmulator', () => {
  const timeline: PersonaRow[] = [
    {
      occurred_at: '2026-04-24T06:00:00-07:00',
      kind: 'note',
      row: { note_id: 'n1', filename: 'a.md', body: 'one' },
    },
    {
      occurred_at: '2026-04-24T07:00:00-07:00',
      kind: 'note',
      row: { note_id: 'n2', filename: 'b.md', body: 'two' },
    },
  ];

  it('emits webhook.persona in order, with burst rate (no sleep)', async () => {
    const seen: string[] = [];
    bus.on('webhook.persona', (p) => {
      seen.push(p.id);
    });
    const emu = createPersonaEmulator(bus, {
      slug: 'avery_chen',
      rate: 'burst',
      timeline,
      now: () => '2026-05-25T00:00:00Z',
    });
    await emu.start();
    await bus.whenDrained();
    expect(seen).toEqual([
      'persona:avery_chen:note:n1',
      'persona:avery_chen:note:n2',
    ]);
    expect(emu.emitted()).toBe(2);
  });

  it('paces between events using the injected sleep', async () => {
    const sleeps: number[] = [];
    const emu = createPersonaEmulator(bus, {
      slug: 'avery_chen',
      rate: '5/sec',
      timeline,
      now: () => 'T',
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await emu.start();
    // N-1 sleeps between N events.
    expect(sleeps).toEqual([200]);
  });

  it('stops early when stop() is called between fires', async () => {
    const seen: string[] = [];
    bus.on('webhook.persona', (p) => {
      seen.push(p.id);
    });
    const emu = createPersonaEmulator(bus, {
      slug: 'avery_chen',
      rate: '5/sec',
      timeline,
      now: () => 'T',
      sleep: async () => {
        emu.stop();
      },
    });
    await emu.start();
    await bus.whenDrained();
    expect(seen).toEqual(['persona:avery_chen:note:n1']);
  });

  it('emits nothing when timeline is empty', async () => {
    const seen: string[] = [];
    bus.on('webhook.persona', (p) => {
      seen.push(p.id);
    });
    const emu = createPersonaEmulator(bus, {
      slug: 'avery_chen',
      rate: 'burst',
      timeline: [],
      now: () => 'T',
    });
    await emu.start();
    expect(seen).toEqual([]);
  });

  it('filters out events at or after skipAfter', async () => {
    const fullTimeline: PersonaRow[] = [
      {
        occurred_at: '2026-04-29T07:00:00-07:00',
        kind: 'note',
        row: { note_id: 'a', filename: 'a.md', body: 'one' },
      },
      {
        occurred_at: '2026-05-02T07:00:00-07:00',
        kind: 'note',
        row: { note_id: 'b', filename: 'b.md', body: 'still in' },
      },
      {
        occurred_at: '2026-05-04T00:00:00-07:00',
        kind: 'note',
        row: { note_id: 'cut', filename: 'cut.md', body: 'at cutoff' },
      },
      {
        occurred_at: '2026-05-10T00:00:00-07:00',
        kind: 'note',
        row: { note_id: 'late', filename: 'late.md', body: 'after cutoff' },
      },
    ];
    const seen: string[] = [];
    bus.on('webhook.persona', (p) => {
      seen.push(p.id);
    });
    const emu = createPersonaEmulator(bus, {
      slug: 'avery_chen',
      rate: 'burst',
      timeline: fullTimeline,
      skipAfter: new Date('2026-05-04T00:00:00-07:00'),
      now: () => 'T',
    });
    await emu.start();
    await bus.whenDrained();
    // 'cut' lands AT skipAfter → dropped. 'late' is after → dropped.
    expect(seen).toEqual([
      'persona:avery_chen:note:a',
      'persona:avery_chen:note:b',
    ]);
  });

  it('filters out events before skipBefore', async () => {
    const fullTimeline: PersonaRow[] = [
      {
        occurred_at: '2026-04-24T07:00:00-07:00',
        kind: 'note',
        row: { note_id: 'pre1', filename: 'pre1.md', body: 'early' },
      },
      {
        occurred_at: '2026-04-28T23:59:59-07:00',
        kind: 'note',
        row: { note_id: 'pre2', filename: 'pre2.md', body: 'still early' },
      },
      {
        occurred_at: '2026-04-29T00:00:00-07:00',
        kind: 'note',
        row: { note_id: 'start', filename: 'start.md', body: 'first to emit' },
      },
      {
        occurred_at: '2026-04-30T09:00:00-07:00',
        kind: 'note',
        row: { note_id: 'after', filename: 'after.md', body: 'also emit' },
      },
    ];
    const seen: string[] = [];
    bus.on('webhook.persona', (p) => {
      seen.push(p.id);
    });
    const emu = createPersonaEmulator(bus, {
      slug: 'avery_chen',
      rate: 'burst',
      timeline: fullTimeline,
      skipBefore: new Date('2026-04-29T00:00:00-07:00'),
      now: () => 'T',
    });
    await emu.start();
    await bus.whenDrained();
    expect(seen).toEqual([
      'persona:avery_chen:note:start',
      'persona:avery_chen:note:after',
    ]);
    expect(emu.emitted()).toBe(2);
  });
});
