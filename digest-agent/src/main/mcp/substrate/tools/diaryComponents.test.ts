import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createSubstrateServer, type SubstrateServer } from '../server.js';

let tmp: string;
let dbPath: string;
let server: SubstrateServer;

const VALID_TEXT =
  "Marcus sent over the revised quote this morning, mirroring the deal terms you walked through Friday with Maya.";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-diary-tools-'));
  dbPath = join(tmp, 'digest.db');
  mkdirSync(join(tmp, 'plays'), { recursive: true });
  server = createSubstrateServer({
    role: 'diary',
    dbPath,
    digestDir: tmp,
    now: () => '2026-04-29T08:00:00-07:00',
  });
});

afterEach(async () => {
  await server.stop();
  rmSync(tmp, { recursive: true, force: true });
});

describe('per-template diary write tools', () => {
  it('exposes a write_<template> tool for every registry entry plus lifecycle primitives', () => {
    const names = server.listTools().sort();
    expect(names).toContain('write_email_draft_inline');
    expect(names).not.toContain('write_email_draft_contextual');
    expect(names).toContain('write_calendar_block_decision');
    expect(names).toContain('write_choose_one_cards');
    expect(names).toContain('write_free_text_reply_compose');
    expect(names).toContain('write_diary_prose_note');
    expect(names).toContain('write_diary_prose_flash');
    expect(names).toContain('write_big_number_metric');
    expect(names).toContain('write_stat_block_summary');
    expect(names).toContain('write_chart_timeseries');
    expect(names).toContain('write_chart_bar');
    expect(names).toContain('write_report_brief');
    expect(names).not.toContain('write_doc_tile_read');
    expect(names).toContain('clear_diary');
    expect(names).toContain('delete_diary_component');
  });

  it('write_diary_prose_note persists a row that round-trips through assembleDiary', async () => {
    await server.callTool('write_diary_prose_note', {
      date: '2026-04-29',
      id: 'note-marcus-quote-2026-04-29',
      section: 'tracking',
      headline: 'Marcus sent the revised quote',
      rationale: "First sight of the post-revision pricing — no action needed yet.",
      anchor_refs: [],
      content: { text: VALID_TEXT },
      actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    });

    const reader = new Database(dbPath, { readonly: true });
    const row = reader
      .prepare(
        "SELECT id, type, template_id, section, status, content, headline FROM diary_components WHERE id = 'note-marcus-quote-2026-04-29'",
      )
      .get() as {
      id: string;
      type: string;
      template_id: string;
      section: string;
      status: string;
      content: string;
      headline: string;
    };
    reader.close();

    expect(row.type).toBe('diary-prose');
    expect(row.template_id).toBe('diary-prose.note');
    expect(row.section).toBe('tracking');
    expect(row.status).toBe('open');
    expect(row.headline).toBe('Marcus sent the revised quote');
    const content = JSON.parse(row.content) as Record<string, string>;
    expect(content['text']).toMatch(/Marcus/);
  });

  it("rejects writes that violate the registry schema (e.g. body where text belongs)", async () => {
    // This is THE failure-mode the registry exists to catch.
    await expect(
      server.callTool('write_diary_prose_note', {
        date: '2026-04-29',
        id: 'bad-1',
        section: 'tracking',
        headline: 'Bad shape',
        anchor_refs: [],
        content: {
          // Wrong key — registry requires `text`, agent supplied `body`.
          body: 'Some prose in the wrong field of more than forty characters total.',
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
      }),
    ).rejects.toThrow();
  });

  it('rejects an action.kind not in the template’s actionKinds allowlist', async () => {
    await expect(
      server.callTool('write_diary_prose_note', {
        date: '2026-04-29',
        id: 'bad-action',
        section: 'tracking',
        headline: 'Bad action',
        anchor_refs: [],
        content: { text: VALID_TEXT },
        // not in diary-prose.note's actionKinds (only `dismiss` is allowed)
        actions: [{ id: 'frob', label: 'Frob', kind: 'send_email' }],
      }),
    ).rejects.toThrow();
  });

  it('upsert preserves comments across re-ticks (id stable)', async () => {
    await server.callTool('write_diary_prose_note', {
      date: '2026-04-29',
      id: 'stable-id',
      section: 'tracking',
      headline: 'v1 headline',
      anchor_refs: [],
      content: { text: VALID_TEXT },
      actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    });
    // Simulate a principal comment landing.
    const writer = new Database(dbPath);
    writer
      .prepare(
        "INSERT INTO diary_comments (id, component_id, text, created_at) VALUES (?, ?, ?, ?)",
      )
      .run('cmt_1', 'stable-id', 'noted', '2026-04-29T09:00:00-07:00');
    writer.close();

    // Re-tick — same id, different headline.
    await server.callTool('write_diary_prose_note', {
      date: '2026-04-29',
      id: 'stable-id',
      section: 'tracking',
      headline: 'v2 headline',
      anchor_refs: [],
      content: {
        text:
          'A revised note on re-tick that still meets the forty-character minimum of the schema.',
      },
      actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    });

    const reader = new Database(dbPath, { readonly: true });
    const updatedHeadline = (
      reader
        .prepare("SELECT headline FROM diary_components WHERE id = 'stable-id'")
        .get() as { headline: string }
    ).headline;
    const commentCount = (
      reader
        .prepare("SELECT COUNT(*) AS n FROM diary_comments WHERE component_id = 'stable-id'")
        .get() as { n: number }
    ).n;
    reader.close();

    expect(updatedHeadline).toBe('v2 headline');
    expect(commentCount).toBe(1); // comment survived the re-tick
  });

  it('clear_diary wipes components for a date', async () => {
    await server.callTool('write_diary_prose_note', {
      date: '2026-04-29',
      id: 'to-clear',
      section: 'tracking',
      headline: 'will be cleared',
      anchor_refs: [],
      content: { text: VALID_TEXT },
      actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    });
    await server.callTool('clear_diary', { date: '2026-04-29' });

    const reader = new Database(dbPath, { readonly: true });
    const count = (
      reader
        .prepare("SELECT COUNT(*) AS n FROM diary_components WHERE diary_date = '2026-04-29'")
        .get() as { n: number }
    ).n;
    reader.close();
    expect(count).toBe(0);
  });

  it('delete_diary_component removes a single row', async () => {
    await server.callTool('write_diary_prose_note', {
      date: '2026-04-29',
      id: 'keep',
      section: 'tracking',
      headline: 'survives',
      anchor_refs: [],
      content: { text: VALID_TEXT },
      actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    });
    await server.callTool('write_diary_prose_note', {
      date: '2026-04-29',
      id: 'drop',
      section: 'tracking',
      headline: 'will be dropped',
      anchor_refs: [],
      content: { text: VALID_TEXT },
      actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    });

    await server.callTool('delete_diary_component', { id: 'drop' });

    const reader = new Database(dbPath, { readonly: true });
    const ids = (
      reader
        .prepare("SELECT id FROM diary_components WHERE diary_date = '2026-04-29' ORDER BY id")
        .all() as Array<{ id: string }>
    ).map((r) => r.id);
    reader.close();
    expect(ids).toEqual(['keep']);
  });
});
