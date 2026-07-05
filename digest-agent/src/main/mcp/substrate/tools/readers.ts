/**
 * File-backed and DB-backed read tools.
 *
 *   read_profile           — principal's profile.md (still on filesystem; user-written)
 *   list_playbook_sections — lists all playbook rows from the `prompts` DB table
 *   read_playbook_section  — reads one playbook row from the `prompts` DB table
 *
 * Playbook sections were previously read from disk at call time. They now live
 * in the `prompts` table (seeded at boot by seedPrompts), so reads go through
 * ctx.db like every other substrate query.
 */

import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineTool } from '../tool.js';
import { makeDiaryRepo } from '../../../db/diary.js';

export const readProfile = defineTool({
  name: 'read_profile',
  description:
    "Read the principal's profile.md (prose self-description). Returns empty string if unset.",
  input: z.object({}).strict(),
  handler: (_args, ctx) => {
    const path = join(ctx.digestDir, 'profile.md');
    if (!existsSync(path)) return { content: '' };
    return { content: readFileSync(path, 'utf-8') };
  },
});

const PLAYBOOK_NAME_REGEX = /^[\w./-]+$/;

function normalizePlaybookName(name: string): string {
  // Agent may include a leading `playbook/` prefix or trailing `.md` — strip both.
  const stripped = name.replace(/^playbook\//, '').replace(/\.md$/, '');
  return `playbook/${stripped}`;
}

export const listPlaybookSections = defineTool({
  name: 'list_playbook_sections',
  description:
    "List every available playbook section by name (path relative to the playbook root, no `.md` suffix). The playbook holds the agent's detailed guidance — the substrate schema (`substrate-schema`), per-section conventions (`sections/urgent-todo`), per-template usage notes (`templates/email-draft.inline`), voice rules (`voice/principal`), suppression and honesty discipline, and the optional `customize` override. Plays are in the `plays` SQL table (read via `run_sql`), not the playbook. Call this to see what's reachable; then `read_playbook_section` for the docs you need.",
  input: z.object({}).strict(),
  handler: (_args, ctx) => {
    const rows = ctx.db
      .prepare(`SELECT name FROM prompts WHERE kind = 'playbook' ORDER BY name ASC`)
      .all() as { name: string }[];
    // Return names without the 'playbook/' prefix so the agent addresses them
    // the same way as before (e.g. 'customize', 'sections/urgent-todo').
    const sections = rows.map((r) => r.name.replace(/^playbook\//, ''));
    return { sections };
  },
});

export const readPlaybookSection = defineTool({
  name: 'read_playbook_section',
  description:
    "Read one playbook section by name (e.g. `substrate-schema`, `customize`, `sections/urgent-todo`, `templates/email-draft.inline`, `voice/principal`, `discipline/suppression`). Returns `{ content }`. Empty string if the section is absent (which means no guidance — fall back to defaults).",
  input: z
    .object({
      name: z
        .string()
        .min(1)
        .max(256)
        .regex(PLAYBOOK_NAME_REGEX, 'name must match [A-Za-z0-9_./-]+'),
    })
    .strict(),
  handler: (args, ctx) => {
    const normalized = normalizePlaybookName(args.name);
    // Block path traversal.
    if (normalized.split('/').some((seg) => seg === '..' || seg === '')) {
      throw new Error(`invalid playbook name: ${args.name}`);
    }
    const row = ctx.db
      .prepare('SELECT content FROM prompts WHERE name = ?')
      .get(normalized) as { content: string } | undefined;
    return { content: row?.content ?? '' };
  },
});

/**
 * Read today's diary components back — no date argument needed.
 * The clock anchor determines "today". Used by the diary agent after writing
 * to verify that all components persisted correctly before appending the
 * thinking layer.
 */
export const readTodayDiary = defineTool({
  name: 'read_today_diary',
  description:
    "Read the components written to today's diary so far. Returns each component's id, section, type, headline, and supporting_artifact_ids. Call this after writing to verify your writes persisted — then append the thinking layer based on what you confirm is actually on the page.",
  input: z.object({}).strict(),
  handler: (_args, ctx) => {
    const date = ctx.now().slice(0, 10);
    const diary = makeDiaryRepo(ctx.db).assembleDiary(date);
    const components = Object.entries(diary.sections).flatMap(([section, comps]) =>
      comps.map((c) => ({
        id: c.id,
        section,
        type: c.type,
        headline: c.headline ?? null,
        supporting_artifact_ids: c.supporting_artifact_ids,
      })),
    );
    return {
      date,
      component_count: components.length,
      components,
      thinking_entries: diary.thinking_layer.length,
    };
  },
});

export const readerTools = {
  [readProfile.name]: readProfile,
  [listPlaybookSections.name]: listPlaybookSections,
  [readPlaybookSection.name]: readPlaybookSection,
  [readTodayDiary.name]: readTodayDiary,
};
