/**
 * Diary template registry — single source of truth.
 *
 * Each entry below is one renderable component shape. The list flows into:
 *   - `src/shared/schemas/index.ts` for the discriminated union on `content`
 *   - `src/main/mcp/substrate/tools/diaryComponents.ts` for the per-template
 *     MCP tool family
 *   - `src/renderer/diary/templates/*.ts` for the content types in the renderer
 *   - `prompts/diary-agent.md` (auto-generated per-template sections)
 *
 * Adding a template:
 *   1. Create `src/shared/templates/<template-id>.ts` calling `defineTemplate(...)`.
 *   2. Append the export to the TEMPLATES tuple below.
 *   3. Add a renderer file at `src/renderer/diary/templates/<template-id>.ts`.
 *   4. Re-run `scripts/regen-diary-prompt.ts` (or rely on prebuild).
 *
 * No other files need to change — tool registration, schema, and prompt
 * sections are all derived from this list.
 */

// `.ts` extensions (not `.js`) so this barrel file loads under Node's
// strip-types runtime (used by scripts/regen-diary-prompt.ts) as well as
// under esbuild. Project tsconfig uses moduleResolution: "Bundler" so both
// extension styles resolve at compile time.
import { bigNumberMetric } from './big-number.metric.ts';
import { calendarBlockDecision } from './calendar-block.decision.ts';
import { chartBar } from './chart.bar.ts';
import { chartTimeseries } from './chart.timeseries.ts';
import { chooseOneCards } from './choose-one.cards.ts';
import { diaryProseFlash } from './diary-prose.flash.ts';
import { diaryProseNote } from './diary-prose.note.ts';
import { emailDraftInline } from './email-draft.inline.ts';
import { freeTextReplyCompose } from './free-text-reply.compose.ts';
import { reportBrief } from './report.brief.ts';
import { statBlockSummary } from './stat-block.summary.ts';

export { defineTemplate, SECTIONS, STATUSES } from './_helpers.ts';
export type { ComponentExample, Section, Status, TemplateSpec } from './_helpers.ts';

export const TEMPLATES = [
  diaryProseNote,
  diaryProseFlash,
  emailDraftInline,
  calendarBlockDecision,
  chooseOneCards,
  freeTextReplyCompose,
  bigNumberMetric,
  statBlockSummary,
  chartTimeseries,
  chartBar,
  reportBrief,
] as const;

export type TemplateRegistryEntry = (typeof TEMPLATES)[number];
export type TemplateId = TemplateRegistryEntry['templateId'];
export type ComponentType = TemplateRegistryEntry['type'];

/**
 * Map from template_id to its inferred content type. Renderer files import
 * via `TemplateContentByTemplateId['diary-prose.note']` to stay in sync.
 */
export type TemplateContentByTemplateId = {
  [E in TemplateRegistryEntry as E['templateId']]: import('zod').z.infer<E['contentSchema']>;
};

/** Look up the registry entry by template_id (compile-time safe). */
export function getTemplate<TID extends TemplateId>(
  templateId: TID,
): Extract<TemplateRegistryEntry, { templateId: TID }> {
  const entry = TEMPLATES.find((t) => t.templateId === templateId);
  if (!entry) {
    throw new Error(
      `unknown template_id: ${templateId} — add it to src/shared/templates/index.ts`,
    );
  }
  return entry as Extract<TemplateRegistryEntry, { templateId: TID }>;
}
