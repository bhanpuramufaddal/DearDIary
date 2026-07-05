/**
 * Registry helpers — single source of truth for diary template contracts.
 *
 * Each template is one file at `src/shared/templates/<template-id>.ts` that
 * calls `defineTemplate({...})` with:
 *   - templateId: the discriminator string (e.g. 'email-draft.inline')
 *   - type:       the broad type bucket (e.g. 'email-draft')
 *   - summary:    one-line description shown in tool docs
 *   - voice:      multi-line guidance on tone and forbidden patterns
 *   - contentSchema: zod schema for the `content` field
 *   - actionKinds:   string[] of valid action.kind values
 *   - goodExample:   a full component example (validated by tests)
 *
 * The registry assembler at `index.ts` collects all of these into the
 * `TEMPLATES` tuple. Renderer types, MCP tool family, and diary agent prompt
 * sections all derive from this list — no second source of truth.
 */

import { z } from 'zod';

/**
 * Sections the agent picks for a component. Mirrors `diarySectionSchema`.
 * Re-declared here to avoid a circular import; kept in sync by tests.
 */
export const SECTIONS = ['right_now', 'on_the_desk', 'tracking', 'background'] as const;
export type Section = (typeof SECTIONS)[number];

/** Status values. Components always start at 'open' from the agent's hand. */
export const STATUSES = ['open', 'acted', 'closed', 'dismissed'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * A full component example, the kind the agent should produce. The agent reads
 * this from the prompt + tool description. Tests verify each `goodExample`
 * validates against its template's contentSchema.
 */
export interface ComponentExample<TContent> {
  /** Stable id, kebab-case, descriptive. Used to dedupe across re-ticks. */
  id: string;
  /** Day this lives on, ISO YYYY-MM-DD. */
  diary_date: string;
  /** Section assignment — agent picks based on urgency. */
  section: Section;
  /** Top-line label, principal voice. NOT a placeholder like 'Document'. */
  headline: string;
  /**
   * Optional one-paragraph rationale. Principal voice — what the principal
   * should notice or do. No internal vocabulary (no "substrate", "anchor",
   * "voice register", "precision", "case_base", etc.).
   */
  rationale?: string;
  /** Anchor IDs this component refers to. Empty array allowed. */
  anchor_refs: string[];
  /** Template-specific content. Shape matches the contentSchema. */
  content: TContent;
  /** Affordances the principal can fire. */
  actions: Array<{ id: string; label: string; kind: string }>;
  /** Always 'open' when first composed. */
  status: 'open';
}

/** A labelled variant example — teaches a specific register or shape. */
export interface TemplateExample<TContent> {
  /** Short label shown as a heading, e.g. "Warm investor reply". */
  label: string;
  /** One phrase describing what this example demonstrates. */
  teaches: string;
  /** The full component example. */
  component: ComponentExample<TContent>;
}

export interface TemplateSpec<
  TID extends string,
  TType extends string,
  CS extends z.ZodTypeAny,
> {
  /** Discriminator. Must be unique across the registry. */
  templateId: TID;
  /** Broad type bucket — used by the renderer for shared CSS rules. */
  type: TType;
  /** One-liner shown in MCP tool description. */
  summary: string;
  /**
   * Voice guidance shown in MCP tool description AND in the diary prompt's
   * per-template section. Multi-line markdown allowed.
   */
  voice: string;
  /** Zod schema for the `content` field. Single source of truth for shape. */
  contentSchema: CS;
  /**
   * Valid `action.kind` values this template supports. Renderer enforces;
   * agent reads from prompt. Empty array means "no actions" (rare).
   */
  actionKinds: readonly string[];
  /**
   * Canonical good example. Tests verify it validates against `contentSchema`.
   * When `examples` is also provided, `goodExample` is still used by tests
   * for schema validation; `examples` drives what the agent prompt shows.
   */
  goodExample: ComponentExample<z.infer<CS>>;
  /**
   * Optional multi-variant examples for the playbook doc. Each entry names
   * what register/situation it demonstrates. When present, `renderTemplateSection`
   * emits these instead of the single `goodExample`. Include 2-3 variants
   * that span different registers (warm/curt/apologetic, metric-hero/anti-pattern, …).
   */
  examples?: TemplateExample<z.infer<CS>>[];
}

/**
 * Identity helper that lets TypeScript infer literal types from the input.
 * `as const` on `templateId`/`type` flows through, so the inferred result
 * carries narrow string types into the union.
 */
export function defineTemplate<
  TID extends string,
  TType extends string,
  CS extends z.ZodTypeAny,
>(spec: TemplateSpec<TID, TType, CS>): TemplateSpec<TID, TType, CS> {
  return spec;
}
