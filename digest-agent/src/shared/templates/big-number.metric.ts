/**
 * big-number.metric — a single hero metric tile.
 *
 * One number, a label, a delta, optional sparkline, and a paraphrased
 * context paragraph that says what to make of the move. The visual is
 * dominated by the number; the context_summary is what makes it diary
 * content rather than dashboard content.
 *
 * Use this template when:
 *   - One number changed materially and is worth surfacing alone.
 *   - Examples: ARR crossed a threshold, weekly active users moved,
 *     a campaign hit a deliverability cliff.
 *
 * Don't use this template when:
 *   - You'd surface 2+ numbers together — use stat-block.summary.
 *   - The story is a trend over time — use chart.timeseries.
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

const deltaSchema = z
  .object({
    direction: z.enum(['up', 'down', 'flat']),
    text: z
      .string()
      .min(1)
      .max(60)
      .describe('Formatted delta string, e.g. "+14% vs last week" or "-$120K MoM".'),
  })
  .strict();

const sparklinePointSchema = z
  .object({
    t: z
      .string()
      .datetime({ offset: true })
      .describe('Point timestamp in ISO 8601 with offset.'),
    y: z.number().describe('Numeric value at this time.'),
  })
  .strict();

export const bigNumberMetricContentSchema = z
  .object({
    label: z
      .string()
      .min(1)
      .max(80)
      .describe('What the number is. e.g. "ARR" or "Weekly active users".'),
    value: z
      .string()
      .min(1)
      .max(40)
      .describe('The number formatted for display. e.g. "$2.4M", "14,300", "92%".'),
    delta: deltaSchema
      .optional()
      .describe('How the number moved, if relevant. Omit for absolute snapshots.'),
    sparkline: z
      .array(sparklinePointSchema)
      .min(2)
      .max(60)
      .optional()
      .describe(
        "Optional time series of recent points. Renderer shows it as a small inline sparkline beside the number.",
      ),
    context_summary: z
      .string()
      .min(40)
      .max(1500)
      .describe(
        "Paraphrased context in your voice. What moved, what caused it, what to make of it. Pull from history and related anchors, not just this datapoint.",
      ),
  })
  .strict();

export const bigNumberMetric = defineTemplate({
  templateId: 'big-number.metric' as const,
  type: 'big-number' as const,
  summary:
    'One hero metric (label + value + delta + optional sparkline) plus paraphrased context.',
  voice:
    "The number is the visual; context_summary is the prose. Lead context with what changed and what caused it, then say what the principal should make of it. Do not narrate the number itself — the renderer shows it.",
  contentSchema: bigNumberMetricContentSchema,
  actionKinds: ['dismiss'],
  goodExample: {
    id: 'arr-crossed-2-4m-2026-05-01',
    diary_date: '2026-05-01',
    section: 'right_now',
    headline: 'ARR crossed $2.4M',
    rationale: "First time above the Series A pricing-model threshold.",
    anchor_refs: ['acme_corp', 'halberd'],
    content: {
      label: 'ARR',
      value: '$2.4M',
      delta: { direction: 'up', text: '+$180K vs last week' },
      sparkline: [
        { t: '2026-04-01T00:00:00-07:00', y: 2090000 },
        { t: '2026-04-08T00:00:00-07:00', y: 2150000 },
        { t: '2026-04-15T00:00:00-07:00', y: 2210000 },
        { t: '2026-04-22T00:00:00-07:00', y: 2280000 },
        { t: '2026-04-29T00:00:00-07:00', y: 2400000 },
      ],
      context_summary:
        "Acme renewed on Tuesday for $96K and Halberd's expansion landed Friday at $84K — together they pushed you across the $2.4M line for the first time. The Series A model assumed $2.3M at term-sheet sign; you are 4 weeks ahead of that on net new alone. Marcus will see this on the cap-table call Wednesday.",
    },
    actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Milestone metric (meaningful threshold crossed)',
      teaches: 'context_summary names WHY this number matters now — ties to a known commitment or model',
      component: {
        id: 'arr-crossed-2-4m-2026-05-01',
        diary_date: '2026-05-01',
        section: 'right_now',
        headline: 'ARR crossed $2.4M',
        rationale: "First time above the Series A pricing-model threshold.",
        anchor_refs: ['acme_corp', 'halberd'],
        content: {
          label: 'ARR',
          value: '$2.4M',
          delta: { direction: 'up', text: '+$180K vs last week' },
          sparkline: [
            { t: '2026-04-01T00:00:00-07:00', y: 2090000 },
            { t: '2026-04-08T00:00:00-07:00', y: 2150000 },
            { t: '2026-04-15T00:00:00-07:00', y: 2210000 },
            { t: '2026-04-22T00:00:00-07:00', y: 2280000 },
            { t: '2026-04-29T00:00:00-07:00', y: 2400000 },
          ],
          context_summary:
            "Acme renewed Tuesday for $96K and Halberd's expansion landed Friday at $84K — together they pushed you across $2.4M for the first time. The Series A model assumed $2.3M at term-sheet sign; you're 4 weeks ahead on net new alone. Marcus will see this on the cap-table call Wednesday.",
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
    {
      label: 'Softening metric (worth flagging, not alarming)',
      teaches: "context_summary names the cause and calibrates urgency — 'worth a look' vs 'alarm'",
      component: {
        id: 'activation-softening-2026-05-05',
        diary_date: '2026-05-05',
        section: 'tracking',
        headline: 'Day-7 activation softened this week',
        anchor_refs: [],
        content: {
          label: 'Day-7 activation',
          value: '42%',
          delta: { direction: 'down', text: '-8 pts vs last week' },
          context_summary:
            "The drop started the week the new onboarding test cohort went live. The control cohort is flat at 50%. It could be seasonality or cohort composition — but if the next cohort (Wednesday) repeats the pattern, the test is the prime suspect and worth pausing before rollout.",
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
  ],
});
