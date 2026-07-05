import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createSubstrateServer, type SubstrateServer } from './server.js';

const T0 = '2026-05-25T12:00:00-07:00';

let tmp: string;
let dbPath: string;
let digestDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-rems-test-'));
  digestDir = tmp;
  dbPath = join(tmp, 'digest.db');
  mkdirSync(join(tmp, 'plays'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function build(): SubstrateServer {
  return createSubstrateServer({ role: 'mind', dbPath, digestDir, now: () => T0 });
}

describe('set_reminder', () => {
  it('inserts reminders + reminder_anchor_refs atomically', async () => {
    const server = build();
    await server.callTool('create_anchor', { display_name: 'Marcus Webb' });

    const res = (await server.callTool('set_reminder', {
      fires_at: '2026-05-29T09:00:00-07:00',
      context: 'follow up on the term sheet',
      anchor_ids: ['marcus_webb'],
    })) as { id: string };
    expect(res.id).toMatch(/^rem_/);

    const row = (await server.callTool('run_sql', {
      sql: 'SELECT fires_at, context, set_by, fired_at FROM reminders WHERE id = ?',
      params: [res.id],
    })) as { rows: Record<string, unknown>[] };
    expect(row.rows[0]).toMatchObject({
      fires_at: '2026-05-29T09:00:00-07:00',
      context: 'follow up on the term sheet',
      set_by: 'mind_agent',
      fired_at: null,
    });

    const refs = (await server.callTool('run_sql', {
      sql: 'SELECT anchor_id FROM reminder_anchor_refs WHERE reminder_id = ?',
      params: [res.id],
    })) as { rows: { anchor_id: string }[] };
    expect(refs.rows.map((r) => r.anchor_id)).toEqual(['marcus_webb']);
  });

  it('rejects when an anchor_id does not exist', async () => {
    const server = build();
    await expect(
      server.callTool('set_reminder', {
        fires_at: '2026-05-29T09:00:00-07:00',
        context: 'x',
        anchor_ids: ['nobody'],
      }),
    ).rejects.toThrow(/anchor not found: nobody/);
  });

  it('allows zero anchor_ids for a global reminder', async () => {
    const server = build();
    const res = (await server.callTool('set_reminder', {
      fires_at: '2026-05-29T09:00:00-07:00',
      context: 'standing thing',
    })) as { id: string };
    const refs = (await server.callTool('run_sql', {
      sql: 'SELECT COUNT(*) AS n FROM reminder_anchor_refs WHERE reminder_id = ?',
      params: [res.id],
    })) as { rows: { n: number }[] };
    expect(refs.rows[0]!.n).toBe(0);
  });
});

describe('cancel_reminder', () => {
  it('removes the row', async () => {
    const server = build();
    const { id } = (await server.callTool('set_reminder', {
      fires_at: '2026-05-29T09:00:00-07:00',
      context: 'x',
    })) as { id: string };
    await server.callTool('cancel_reminder', { id });
    const row = (await server.callTool('run_sql', {
      sql: 'SELECT COUNT(*) AS n FROM reminders WHERE id = ?',
      params: [id],
    })) as { rows: { n: number }[] };
    expect(row.rows[0]!.n).toBe(0);
  });

  it('throws on missing reminder', async () => {
    const server = build();
    await expect(
      server.callTool('cancel_reminder', { id: 'rem_missing' }),
    ).rejects.toThrow(/reminder not found/);
  });
});
