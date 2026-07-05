/**
 * stat-block.summary — 3–6 metrics together with a context paragraph.
 *
 * For roll-up surfaces where the story is a cluster of numbers rather than
 * one hero number. The context_summary at the top says what the cluster
 * means together; each row is a label + value + delta.
 *
 * Use this template when:
 *   - Several numbers belong together (weekly business roll-up, end-of-month
 *     snapshot, campaign post-mortem).
 *
 * Don't use this template when:
 *   - One number dominates — use big-number.metric.
 *   - The story is a chart — use chart.timeseries or chart.bar.
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

const deltaSchema = z
  .object({
    direction: z.enum(['up', 'down', 'flat']),
    text: z.string().min(1).max(60),
  })
  .strict();

const statRowSchema = z
  .object({
    label: z.string().min(1).max(80).describe('What this row measures.'),
    value: z.string().min(1).max(40).describe('The number, formatted for display.'),
    delta: deltaSchema.optional().describe('How the number moved, if relevant.'),
  })
  .strict();

export const statBlockSummaryContentSchema = z
  .object({
    context_summary: z
      .string()
      .min(40)
      .max(1500)
      .describe(
        "Paraphrased context in your voice naming what the cluster of numbers means together. Not a per-row narration — the rows speak for themselves; the summary frames the story.",
      ),
    rows: z
      .array(statRowSchema)
      .min(3)
      .max(6)
      .describe('Between 3 and 6 stat rows. Order from most to least important.'),
  })
  .strict();

export const statBlockSummary = defineTemplate({
  templateId: 'stat-block.summary' as const,
  type: 'stat-block' as const,
  summary: '3–6 metric rows with a paraphrased context paragraph naming the cluster story.',
  voice:
    "The summary names the overall story (\"a strong revenue week with two soft spots\"). Rows are factual: label, value, delta. The agent does not narrate inside rows.",
  contentSchema: statBlockSummaryContentSchema,
  actionKinds: ['dismiss'],
  goodExample: {
    id: 'weekly-rollup-2026-05-04',
    diary_date: '2026-05-04',
    section: 'on_the_desk',
    headline: 'Last week, at a glance',
    rationale: 'Roll-up of the metrics you watch on Monday mornings.',
    anchor_refs: [],
    content: {
      context_summary:
        "Revenue had its best week of the quarter on the back of the Acme renewal and Halberd's expansion. Activation softened — the new onboarding test cohort underperforms last week's control by 8 points and is worth a look before the next cohort goes live Wednesday. Support load is flat; engineering shipped on plan.",
      rows: [
        {
          label: 'New ARR',
          value: '$180K',
          delta: { direction: 'up', text: '+$120K vs prior wk' },
        },
        {
          label: 'Activation (day-7)',
          value: '42%',
          delta: { direction: 'down', text: '-8 pts vs prior wk' },
        },
        {
          label: 'Support tickets',
          value: '47',
          delta: { direction: 'flat', text: 'flat vs prior wk' },
        },
        {
          label: 'PRs shipped',
          value: '23',
          delta: { direction: 'up', text: '+3 vs prior wk' },
        },
      ],
    },
    actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Weekly roll-up (mixed signals)',
      teaches: 'context_summary names the cluster story before listing rows; highlights the anomaly without over-alarming',
      component: {
        id: 'weekly-rollup-2026-05-04',
        diary_date: '2026-05-04',
        section: 'on_the_desk',
        headline: 'Last week, at a glance',
        rationale: 'Roll-up of the metrics you watch on Monday mornings.',
        anchor_refs: [],
        content: {
          context_summary:
            "Revenue had its best week of the quarter on the back of the Acme renewal and Halberd's expansion. Activation softened — the new onboarding test cohort underperforms last week's control by 8 points and is worth a look before the next cohort goes live Wednesday. Support load is flat; engineering shipped on plan.",
          rows: [
            { label: 'New ARR', value: '$180K', delta: { direction: 'up', text: '+$120K vs prior wk' } },
            { label: 'Activation (day-7)', value: '42%', delta: { direction: 'down', text: '-8 pts vs prior wk' } },
            { label: 'Support tickets', value: '47', delta: { direction: 'flat', text: 'flat vs prior wk' } },
            { label: 'PRs shipped', value: '23', delta: { direction: 'up', text: '+3 vs prior wk' } },
          ],
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
    {
      label: 'Hiring loop snapshot',
      teaches: 'stat-block for qualitative/count metrics with no delta needed; context names what to do with the pattern',
      component: {
        id: 'hiring-loop-snapshot-2026-05-06',
        diary_date: '2026-05-06',
        section: 'tracking',
        headline: 'Hiring loop — current state',
        anchor_refs: [],
        content: {
          context_summary:
            "Three roles in active process. Eng lead is the most time-sensitive — offer window closes Friday. Design is stalled at panel stage; no feedback from two of the three interviewers after 5 days. Head of Sales is moving on plan.",
          rows: [
            { label: 'Eng lead', value: 'Offer ready', delta: { direction: 'flat', text: 'window closes Fri' } },
            { label: 'Product designer', value: 'Panel pending', delta: { direction: 'down', text: '2 panelists overdue' } },
            { label: 'Head of Sales', value: 'Final round', delta: { direction: 'up', text: 'on track' } },
          ],
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
  ],
});
