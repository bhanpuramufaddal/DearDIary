/**
 * Per-template diary-write tool family.
 *
 * Replaces the single shape-loose `write_diary` tool. For each template in
 * `src/shared/templates/`, this module exports one MCP tool whose input is
 * the strict registry-derived shape (registry's `contentSchema` plus the
 * wrapper fields the agent picks: id, section, headline, rationale, anchor_refs,
 * actions). The handler upserts one row in `diary_components` via
 * `makeDiaryRepo(db).upsertComponent`.
 *
 * Plus two lifecycle primitives:
 *   - `clear_diary(date)`         — wipes components for a date (start-of-tick)
 *   - `delete_diary_component(id)` — explicit removal
 *
 * Schema bound to template_id: the per-template tools are how the registry
 * contract gets ENFORCED at the MCP boundary. The agent calling
 * `write_diary_prose_note` with a missing `text` gets a loud zod error and
 * retries, instead of writing junk and the renderer silently rendering empty.
 */

import { z } from 'zod';
import type { AnchorId, DiaryComponentId } from '@shared/types/ids.js';
import type { ComponentStatus, TemplateId } from '@shared/types/diary.js';
import { TEMPLATES } from '@shared/templates/index.js';
import { makeDiaryRepo } from '../../../db/diary.js';
import { defineTool, type AnyTool } from '../tool.js';

/** Wrapper fields shared by every per-template write tool. */
const baseWrapper = {
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Diary date in YYYY-MM-DD.'),
  id: z
    .string()
    .min(1)
    .max(128)
    .describe(
      'Stable component id, kebab-case + date suffix (e.g. "renee-intro-2026-04-29"). Reuse the same id on re-tick to preserve comments.',
    ),
  section: z
    .string()
    .min(1)
    .max(64)
    .describe(
      'Which section of the diary this component lands under. Free-form string — choose from the conventional vocabulary in the playbook (`if_one_thing`, `urgent_todo`, `decisions_approvals`, `team_pulse`, `calendar_personal`, optional `ai_industry_news`) unless customize.md instructs otherwise. The renderer groups by whatever label you write.',
    ),
  headline: z
    .string()
    .min(1)
    .max(256)
    .describe('Principal-facing one-liner. Never "Document" or other placeholders.'),
  rationale: z
    .string()
    .max(4000)
    .optional()
    .describe(
      'Optional one-paragraph rationale in PRINCIPAL voice. Tell the principal what to notice or do. NO internal vocabulary — no "substrate", "anchor", "voice register", "precision", "case_base", etc.',
    ),
  anchor_refs: z
    .array(z.string().min(1))
    .default([])
    .describe('Anchor ids this component refers to. Empty array allowed.'),
  supporting_artifact_ids: z
    .array(z.string().min(1).max(512))
    .default([])
    .describe(
      "Source ids (e.g. `gmail:<msg-id>`, `gcal:<event-uid>`, `notion:<page-id>`) the component cites. Every concrete claim in the headline / rationale / content should trace to at least one entry here. The renderer formats each id as an inline citation like `[email: Marcus, May 19 16:42]` so the principal can see what backs each surface.",
    ),
} as const;

interface RegistryEntry {
  templateId: string;
  type: string;
  summary: string;
  voice: string;
  contentSchema: z.ZodTypeAny;
  actionKinds: readonly string[];
}

interface ComponentWriteArgs {
  date: string;
  id: string;
  section: string;
  headline: string;
  rationale?: string;
  anchor_refs?: string[];
  supporting_artifact_ids?: string[];
  content: Record<string, unknown>;
  actions: Array<{ id: string; label: string; kind: string }>;
}

/**
 * Build the MCP tool for one registry entry. Tool name = `write_<template>`
 * with dots/dashes → underscores so the LLM has a clean snake_case identifier.
 *
 * Returns `AnyTool` (the catalog's uniform shape) rather than a more specific
 * type because the per-template handler closes over `entry` and the inferred
 * schema is template-specific — uniform typing requires erasure.
 */
function buildWriteTool(entry: RegistryEntry): AnyTool {
  const toolName = `write_${entry.templateId.replace(/[-.]/g, '_')}`;

  // Tool description carries everything the LLM should know to use it well:
  // summary, voice notes, the actionKinds list. The per-field .describe()
  // strings on the schema show up in MCP's tool-list response as JSON Schema
  // descriptions — that's how the field-level teaching surfaces.
  const description = [
    entry.summary,
    '',
    'Voice:',
    entry.voice,
    '',
    `Valid action.kind values: ${entry.actionKinds.join(', ') || '(none)'}`,
  ].join('\n');

  const actionSchema = z
    .object({
      id: z.string().min(1).max(64),
      label: z.string().min(1).max(128),
      kind: z.enum(entry.actionKinds as [string, ...string[]]),
    })
    .strict();

  const inputSchema = z
    .object({
      ...baseWrapper,
      content: entry.contentSchema,
      actions: z
        .array(actionSchema)
        .min(1)
        .max(4)
        .describe(
          'Affordances the principal can fire. At least one; keep to ≤ 4 so the page stays scannable.',
        ),
    })
    .strict();

  return {
    name: toolName,
    description,
    input: inputSchema as unknown as z.ZodType<unknown, z.ZodTypeDef, unknown>,
    handler: (raw: unknown, ctx) => {
      const args = raw as ComponentWriteArgs;
      const diary = makeDiaryRepo(ctx.db);
      diary.upsertComponent({
        id: args.id as DiaryComponentId,
        diary_date: args.date,
        type: entry.type as
          | 'email-draft'
          | 'calendar-block'
          | 'choose-one'
          | 'free-text-reply'
          | 'diary-prose'
          | 'big-number'
          | 'stat-block'
          | 'chart'
          | 'report',
        section: args.section,
        template_id: entry.templateId as TemplateId,
        ...(args.headline !== undefined ? { headline: args.headline } : {}),
        ...(args.rationale !== undefined ? { rationale: args.rationale } : {}),
        content: args.content,
        actions: args.actions,
        anchor_refs: (args.anchor_refs ?? []) as AnchorId[],
        supporting_artifact_ids: args.supporting_artifact_ids ?? [],
        status: 'open' as ComponentStatus,
      });
      return { id: args.id };
    },
  };
}

/** Tools generated from the registry — one per template. */
const WRITE_TOOLS: Record<string, AnyTool> = Object.fromEntries(
  TEMPLATES.map((entry) => {
    const tool = buildWriteTool(entry as unknown as RegistryEntry);
    return [tool.name, tool];
  }),
);

// ─── Lifecycle primitives ─────────────────────────────────────────────────

const clearDiary = defineTool({
  name: 'clear_diary',
  description:
    "Wipe every component for a given date. Use at the START of a diary tick when you intend to recompose the day from scratch. Notes and thinking_layer survive. Comments on dropped components are removed (CASCADE).",
  input: z
    .object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('Diary date in YYYY-MM-DD.'),
    })
    .strict(),
  handler: (args, ctx) => {
    const diary = makeDiaryRepo(ctx.db);
    diary.clearComponents(args.date);
    return { date: args.date };
  },
});

const deleteDiaryComponent = defineTool({
  name: 'delete_diary_component',
  description:
    "Remove one component by id. CASCADE drops its comments and anchor refs. Use when carrying a tick forward and one item from yesterday no longer belongs.",
  input: z
    .object({
      id: z.string().min(1).max(128),
    })
    .strict(),
  handler: (args, ctx) => {
    const diary = makeDiaryRepo(ctx.db);
    diary.deleteComponent(args.id as DiaryComponentId);
    return { id: args.id };
  },
});

/**
 * The per-template tool family, ready to merge into the substrate catalog.
 * Tool names are deterministic: `write_<template-id-with-underscores>`.
 */
export const diaryComponentTools = {
  ...WRITE_TOOLS,
  [clearDiary.name]: clearDiary,
  [deleteDiaryComponent.name]: deleteDiaryComponent,
};

/** Tool names for the registry-generated family — used by the catalog. */
export const diaryComponentToolNames: readonly string[] = Object.keys(diaryComponentTools);
