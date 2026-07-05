import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createPersonaEmailServer } from './personaEmail/server.js';
import { createPersonaCalendarServer } from './personaCalendar/server.js';
import { createPersonaNotesServer } from './personaNotes/server.js';

const T0 = '2026-04-29T07:00:00-07:00';

let tmp: string;
let personaDbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'persona-services-test-'));
  personaDbPath = join(tmp, 'persona.db');
  seedPersonaDb(personaDbPath);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function seedPersonaDb(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE emails (
      message_id VARCHAR NOT NULL PRIMARY KEY,
      artifact_id VARCHAR,
      thread_id VARCHAR,
      from_addr VARCHAR NOT NULL,
      to_addrs_json VARCHAR NOT NULL,
      cc_addrs_json VARCHAR,
      subject VARCHAR NOT NULL,
      date_iso VARCHAR NOT NULL,
      in_reply_to VARCHAR,
      body VARCHAR NOT NULL
    );
    CREATE TABLE calendar_ops (
      op_id INTEGER NOT NULL PRIMARY KEY,
      ts_iso VARCHAR NOT NULL,
      op VARCHAR NOT NULL,
      event_id VARCHAR NOT NULL,
      source VARCHAR NOT NULL,
      linked_message_id VARCHAR,
      payload_json VARCHAR NOT NULL
    );
    CREATE TABLE notes (
      note_id VARCHAR NOT NULL PRIMARY KEY,
      artifact_id VARCHAR,
      filename VARCHAR NOT NULL UNIQUE,
      title VARCHAR,
      body VARCHAR NOT NULL,
      created_iso VARCHAR NOT NULL,
      updated_iso VARCHAR
    );
  `);

  const insertEmail = db.prepare(
    `INSERT INTO emails (message_id, thread_id, from_addr, to_addrs_json, cc_addrs_json, subject, date_iso, in_reply_to, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertEmail.run(
    'msg_001',
    'thread_a',
    'marcus@example.com',
    JSON.stringify(['avery@example.com']),
    'null', // persona-gen empty-cc idiom
    'Quote for next quarter',
    '2026-04-25T14:00:00-07:00',
    null,
    'Hi Avery — sending over the revised quote. Let me know by Friday.',
  );
  insertEmail.run(
    'msg_002',
    'thread_a',
    'avery@example.com',
    JSON.stringify(['marcus@example.com']),
    JSON.stringify(['maya@example.com']),
    'Re: Quote for next quarter',
    '2026-04-26T09:15:00-07:00',
    'msg_001',
    'Thanks Marcus. Looping in Maya for visibility.',
  );
  insertEmail.run(
    'msg_003',
    null,
    'newsletter@vendor.com',
    JSON.stringify(['avery@example.com']),
    null,
    'Weekly digest',
    '2026-04-28T06:00:00-07:00',
    null,
    'Top stories this week...',
  );
  insertEmail.run(
    'msg_old',
    null,
    'old@example.com',
    JSON.stringify(['avery@example.com']),
    null,
    'Ancient message',
    '2026-04-01T12:00:00-07:00',
    null,
    'Very old.',
  );

  const insertCalop = db.prepare(
    `INSERT INTO calendar_ops (op_id, ts_iso, op, event_id, source, linked_message_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertCalop.run(
    1,
    '2026-04-25T10:00:00-07:00',
    'create',
    'evt_standup',
    'gcal',
    null,
    JSON.stringify({ title: 'Maya 1:1', start: '2026-04-28T09:00:00-07:00' }),
  );
  insertCalop.run(
    2,
    '2026-04-27T16:00:00-07:00',
    'update',
    'evt_standup',
    'gcal',
    null,
    JSON.stringify({ title: 'Maya 1:1', start: '2026-04-28T10:00:00-07:00' }),
  );

  const insertNote = db.prepare(
    `INSERT INTO notes (note_id, filename, title, body, created_iso, updated_iso)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertNote.run(
    'note_001',
    'q2-priorities.md',
    'Q2 priorities',
    'Top of mind: ship the migration, close Marcus deal, hire one EM.',
    '2026-04-26T18:00:00-07:00',
    '2026-04-27T08:00:00-07:00',
  );
  insertNote.run(
    'note_002',
    'sprint-notes.md',
    'Sprint notes',
    'Halberd rollout on track for May 28.',
    '2026-04-20T11:00:00-07:00',
    null,
  );

  db.close();
}

// ─── persona-email ──────────────────────────────────────────────────────────

describe('persona-email — tool surface', () => {
  it('lists the 4 documented tools', () => {
    const server = createPersonaEmailServer({ personaDbPath, now: () => T0 });
    expect(server.listTools().sort()).toEqual([
      'get_email',
      'get_thread',
      'list_emails',
      'search_emails',
    ]);
  });
});

describe('persona-email — list_emails', () => {
  it('serves a date-range historical snapshot', async () => {
    const server = createPersonaEmailServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('list_emails', {
      since: '2026-04-24T00:00:00-07:00',
      until: T0,
      limit: 50,
    })) as { count: number; emails: Array<{ message_id: string; cc: string[] }> };
    expect(result.count).toBe(3);
    expect(result.emails.map((e) => e.message_id)).toEqual(['msg_001', 'msg_002', 'msg_003']);
    // empty-cc 'null' normalizes to []
    expect(result.emails[0]!.cc).toEqual([]);
  });

  it('filters by sender substring', async () => {
    const server = createPersonaEmailServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('list_emails', {
      from: 'marcus@',
      limit: 10,
    })) as { count: number };
    expect(result.count).toBe(1);
  });

  it('flips order with order:"desc"', async () => {
    const server = createPersonaEmailServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('list_emails', {
      since: '2026-04-24T00:00:00-07:00',
      order: 'desc',
      limit: 50,
    })) as { emails: Array<{ message_id: string }> };
    expect(result.emails[0]!.message_id).toBe('msg_003');
  });
});

describe('persona-email — get_thread', () => {
  it('returns every message in a thread, oldest-first', async () => {
    const server = createPersonaEmailServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('get_thread', { thread_id: 'thread_a' })) as {
      count: number;
      messages: Array<{ message_id: string }>;
    };
    expect(result.count).toBe(2);
    expect(result.messages.map((m) => m.message_id)).toEqual(['msg_001', 'msg_002']);
  });

  it('throws on unknown thread', async () => {
    const server = createPersonaEmailServer({ personaDbPath, now: () => T0 });
    await expect(
      server.callTool('get_thread', { thread_id: 'nope' }),
    ).rejects.toThrow(/thread not found/);
  });
});

// ─── persona-calendar ───────────────────────────────────────────────────────

describe('persona-calendar — tool surface', () => {
  it('lists the 4 documented tools', () => {
    const server = createPersonaCalendarServer({ personaDbPath, now: () => T0 });
    expect(server.listTools().sort()).toEqual([
      'get_event',
      'list_events',
      'list_operations',
      'search_events',
    ]);
  });
});

describe('persona-calendar — list_operations vs list_events', () => {
  it('list_operations returns every op (multiple per event)', async () => {
    const server = createPersonaCalendarServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('list_operations', {
      since: '2026-04-20T00:00:00-07:00',
      until: T0,
      limit: 50,
    })) as { count: number };
    expect(result.count).toBe(2); // create + update on evt_standup
  });

  it('list_events returns the latest op per event_id', async () => {
    const server = createPersonaCalendarServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('list_events', {
      since: '2026-04-20T00:00:00-07:00',
      until: T0,
      limit: 50,
    })) as { count: number; events: Array<{ op: string; op_id: number }> };
    expect(result.count).toBe(1); // one event_id
    expect(result.events[0]!.op_id).toBe(2); // the update wins
    expect(result.events[0]!.op).toBe('update');
  });

  it('get_event returns the full op history for one event', async () => {
    const server = createPersonaCalendarServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('get_event', { event_id: 'evt_standup' })) as {
      count: number;
      operations: Array<{ op: string }>;
    };
    expect(result.count).toBe(2);
    expect(result.operations.map((o) => o.op)).toEqual(['create', 'update']);
  });
});

// ─── persona-notes ──────────────────────────────────────────────────────────

describe('persona-notes — tool surface', () => {
  it('lists the 4 documented tools', () => {
    const server = createPersonaNotesServer({ personaDbPath, now: () => T0 });
    expect(server.listTools().sort()).toEqual([
      'get_note',
      'get_note_at',
      'list_notes',
      'search_notes',
    ]);
  });
});

describe('persona-notes — list_notes', () => {
  it('returns notes by last-touched (updated_iso || created_iso)', async () => {
    const server = createPersonaNotesServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('list_notes', {
      since: '2026-04-26T00:00:00-07:00',
      until: T0,
      limit: 10,
    })) as { count: number; notes: Array<{ note_id: string }> };
    // note_001 last-touched Apr 27, note_002 last-touched Apr 20 (outside)
    expect(result.count).toBe(1);
    expect(result.notes[0]!.note_id).toBe('note_001');
  });

  it('point-in-time `at` query returns notes that existed by that timestamp', async () => {
    const server = createPersonaNotesServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('list_notes', {
      at: '2026-04-21T00:00:00-07:00',
      limit: 10,
    })) as { count: number; notes: Array<{ note_id: string }> };
    // Only note_002 existed by Apr 21 (created Apr 20). note_001 was created Apr 26.
    expect(result.count).toBe(1);
    expect(result.notes[0]!.note_id).toBe('note_002');
  });
});

describe('persona-notes — get_note_at', () => {
  it("flags `stale: true` when the note was edited after the requested timestamp", async () => {
    const server = createPersonaNotesServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('get_note_at', {
      note_id: 'note_001',
      at: '2026-04-26T20:00:00-07:00',
    })) as { stale: boolean; as_of: string; updated_at: string | null };
    // Requested at Apr 26 8pm; note was created Apr 26 6pm and updated Apr 27 8am.
    // The latest content (as_of = updated_iso) is AFTER the request → stale.
    expect(result.stale).toBe(true);
    expect(result.as_of).toBe('2026-04-27T08:00:00-07:00');
  });

  it('returns null when the note did not exist by `at`', async () => {
    const server = createPersonaNotesServer({ personaDbPath, now: () => T0 });
    const result = (await server.callTool('get_note_at', {
      note_id: 'note_001',
      at: '2026-04-20T00:00:00-07:00',
    })) as null | { stale: boolean };
    expect(result).toBeNull();
  });
});
