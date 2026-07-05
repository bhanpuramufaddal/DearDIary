/**
 * chart.bar — categorical bar chart.
 *
 * For comparisons across categories — top deals by size, channel mix,
 * support tickets by team, regional revenue. The context_summary names
 * what the comparison reveals.
 *
 * Use this template when:
 *   - The matter is a categorical comparison, not a trend.
 *
 * Don't use this template when:
 *   - The story is a trend over time — use chart.timeseries.
 *   - One number dominates — use big-number.metric.
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

const barSchema = z
  .object({
    label: z.string().min(1).max(80).describe('Category label shown on the axis.'),
    value: z.number().describe('Bar height for this category.'),
  })
  .strict();

export const chartBarContentSchema = z
  .object({
    context_summary: z
      .string()
      .min(40)
      .max(1500)
      .describe(
        "Paraphrased context in your voice naming what the comparison reveals (\"customer support tickets cluster on one team\"). Do not list bar values — the renderer shows them.",
      ),
    y_axis_label: z.string().min(1).max(80).describe('What the bar height measures.'),
    bars: z
      .array(barSchema)
      .min(2)
      .max(20)
      .describe('Between 2 and 20 categorical bars. Order matters — render in array order.'),
  })
  .strict();

export const chartBar = defineTemplate({
  templateId: 'chart.bar' as const,
  type: 'chart' as const,
  summary: 'Categorical bar chart with a paraphrased context paragraph naming the story.',
  voice:
    "The chart shows the comparison; the summary names what it reveals (\"three deals dominate the pipeline by size\"). Do not enumerate bars in the prose.",
  contentSchema: chartBarContentSchema,
  actionKinds: ['dismiss'],
  goodExample: {
    id: 'pipeline-top-deals-2026-05-04',
    diary_date: '2026-05-04',
    section: 'tracking',
    headline: 'Pipeline weight is concentrated in three deals',
    rationale: 'Top of pipe by expected ARR.',
    anchor_refs: ['acme_corp', 'halberd', 'bench_accounting'],
    content: {
      context_summary:
        "The top three deals account for roughly 70% of the current pipeline by expected ARR — Acme expansion, Halberd net new, Bench expansion. If any one of them slips beyond Q2, the quarterly model drops below the Series A pricing threshold. The rest of the pipeline is healthy but unconcentrated; treat the top three as the sensitive set.",
      y_axis_label: 'Expected ARR ($K)',
      bars: [
        { label: 'Acme', value: 320 },
        { label: 'Halberd', value: 240 },
        { label: 'Bench', value: 180 },
        { label: 'Holdfast', value: 90 },
        { label: 'Gabe Corp', value: 60 },
        { label: 'Other', value: 70 },
      ],
    },
    actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Pipeline concentration (the point is risk)',
      teaches: 'context_summary draws the implication — not just what the chart shows, but what it means for action',
      component: {
        id: 'pipeline-top-deals-2026-05-04',
        diary_date: '2026-05-04',
        section: 'tracking',
        headline: 'Pipeline weight is concentrated in three deals',
        rationale: 'Top of pipe by expected ARR.',
        anchor_refs: ['acme_corp', 'halberd', 'bench_accounting'],
        content: {
          context_summary:
            "The top three deals account for roughly 70% of the current pipeline by expected ARR — Acme expansion, Halberd net new, Bench expansion. If any one of them slips beyond Q2, the quarterly model drops below the Series A pricing threshold. The rest of the pipeline is healthy but unconcentrated; treat the top three as the sensitive set.",
          y_axis_label: 'Expected ARR ($K)',
          bars: [
            { label: 'Acme', value: 320 },
            { label: 'Halberd', value: 240 },
            { label: 'Bench', value: 180 },
            { label: 'Holdfast', value: 90 },
            { label: 'Gabe Corp', value: 60 },
            { label: 'Other', value: 70 },
          ],
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
    {
      label: 'Support ticket distribution (the point is skew)',
      teaches: "context_summary names the skew and what to do about it — not a description of which bar is tallest",
      component: {
        id: 'support-by-customer-2026-05-07',
        diary_date: '2026-05-07',
        section: 'tracking',
        headline: "Support tickets are clustering on Halberd",
        anchor_refs: ['halberd'],
        content: {
          context_summary:
            "Halberd accounts for 40% of open support tickets this week despite being one of six active accounts. The spike started Monday after their migration. Worth a direct outreach before it becomes a renewal signal — their CFO renewal meeting is in 3 weeks.",
          y_axis_label: 'Open tickets',
          bars: [
            { label: 'Halberd', value: 19 },
            { label: 'Acme', value: 8 },
            { label: 'Bench', value: 6 },
            { label: 'Holdfast', value: 5 },
            { label: 'Other', value: 9 },
          ],
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
  ],
});
