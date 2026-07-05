/**
 * report.brief — short structured report. Long-form narrative with 1–2
 * inline charts interleaved. The synthesis is the prose; the charts are
 * illustration, not the point.
 *
 * Use this template when:
 *   - You're delivering a weekly synthesis, a monthly business review,
 *     a project post-mortem, or any matter that needs sustained narrative
 *     plus a small amount of visualization.
 *
 * Don't use this template when:
 *   - One number dominates — use big-number.metric.
 *   - The cluster is 3–6 rows of numbers without narrative arc — use
 *     stat-block.summary.
 *   - The story is a single chart — use chart.timeseries / chart.bar.
 *   - The matter is short enough to fit in diary-prose.note — most things are.
 *
 * Discipline. Brief means brief: total 2–6 blocks, at most 2 chart blocks.
 * If the body wants to grow past 6 blocks, the report is the wrong shape
 * for the matter.
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

const proseBlockSchema = z
  .object({
    kind: z.literal('prose'),
    text: z
      .string()
      .min(40)
      .max(3000)
      .describe(
        "A paragraph (or short cluster of paragraphs) in your voice. Each prose block carries one move of the argument — frame, evidence, implication, takeaway. Lead with the move, not preamble.",
      ),
  })
  .strict();

const timeseriesBlockSchema = z
  .object({
    kind: z.literal('timeseries'),
    caption: z.string().max(200).optional().describe('Short caption shown above the chart.'),
    y_axis_label: z.string().min(1).max(80),
    x_axis_label: z.string().min(1).max(80).optional(),
    series: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            points: z
              .array(
                z
                  .object({
                    t: z.string().datetime({ offset: true }),
                    y: z.number(),
                  })
                  .strict(),
              )
              .min(2)
              .max(500),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

const barBlockSchema = z
  .object({
    kind: z.literal('bar'),
    caption: z.string().max(200).optional().describe('Short caption shown above the chart.'),
    y_axis_label: z.string().min(1).max(80),
    bars: z
      .array(
        z
          .object({
            label: z.string().min(1).max(80),
            value: z.number(),
          })
          .strict(),
      )
      .min(2)
      .max(20),
  })
  .strict();

const blockSchema = z.discriminatedUnion('kind', [
  proseBlockSchema,
  timeseriesBlockSchema,
  barBlockSchema,
]);

export const reportBriefContentSchema = z
  .object({
    blocks: z
      .array(blockSchema)
      .min(2)
      .max(6)
      .describe(
        'Ordered blocks (prose or chart). 2–6 total; at most 2 chart blocks. Renderer paints in array order — design the sequence: frame → evidence (maybe with a chart) → takeaway.',
      ),
  })
  .strict()
  .refine(
    (val) => val.blocks.filter((b) => b.kind !== 'prose').length <= 2,
    { message: 'A brief carries at most 2 chart blocks; trim to keep the report brief.' },
  );

export const reportBrief = defineTemplate({
  templateId: 'report.brief' as const,
  type: 'report' as const,
  summary:
    'Short structured report — 2–6 blocks of prose interleaved with up to 2 inline charts. The narrative carries the argument; the charts illustrate.',
  voice:
    "Memo voice. Each prose block carries one move; the sequence is the argument. Open with what the report is and what it concludes; close with what the principal should notice or do. Charts are illustration — name the move in the surrounding prose, do not narrate the axes.",
  contentSchema: reportBriefContentSchema,
  actionKinds: ['dismiss'],
  goodExample: {
    id: 'weekly-business-brief-2026-05-04',
    diary_date: '2026-05-04',
    section: 'on_the_desk',
    headline: 'Weekly business brief',
    rationale: 'Synthesis for the Monday roll-up.',
    anchor_refs: [],
    content: {
      blocks: [
        {
          kind: 'prose',
          text: "Last week was the strongest revenue week of the quarter — Acme's renewal and Halberd's expansion together added $180K of new ARR, pulling you above the $2.4M line for the first time. Underneath the revenue, activation softened: the new onboarding test cohort underperforms control by 8 points and has done so three weeks running.",
        },
        {
          kind: 'timeseries',
          caption: 'Day-7 activation, last 4 weeks',
          y_axis_label: 'Day-7 activation (%)',
          x_axis_label: 'Week ending',
          series: [
            {
              name: 'Test cohort',
              points: [
                { t: '2026-04-12T00:00:00-07:00', y: 50.1 },
                { t: '2026-04-19T00:00:00-07:00', y: 48.4 },
                { t: '2026-04-26T00:00:00-07:00', y: 45.2 },
                { t: '2026-05-03T00:00:00-07:00', y: 42.0 },
              ],
            },
            {
              name: 'Control',
              points: [
                { t: '2026-04-12T00:00:00-07:00', y: 49.8 },
                { t: '2026-04-19T00:00:00-07:00', y: 50.2 },
                { t: '2026-04-26T00:00:00-07:00', y: 50.0 },
                { t: '2026-05-03T00:00:00-07:00', y: 49.6 },
              ],
            },
          ],
        },
        {
          kind: 'prose',
          text: "The control cohort is flat near 50% — the gap is in the test, not seasonality. The next cohort goes live Wednesday; if it repeats the pattern, you would want to pause the test before rolling further. Support load held flat at 47 tickets; engineering shipped 23 PRs (above plan); Marcus said the cap-table call Wednesday will be the gating decision on the Series A timing.",
        },
        {
          kind: 'prose',
          text: "Takeaway: a strong revenue week riding on two named accounts, one product signal worth investigating before Wednesday, and a Series A decision that will set the next two weeks of priorities.",
        },
      ],
    },
    actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Weekly business brief (prose + chart)',
      teaches: 'open with the headline conclusion; use one chart inline; close with the one thing to watch',
      component: {
        id: 'weekly-business-brief-2026-05-04',
        diary_date: '2026-05-04',
        section: 'on_the_desk',
        headline: 'Weekly business brief',
        rationale: 'Synthesis for the Monday roll-up.',
        anchor_refs: [],
        content: {
          blocks: [
            {
              kind: 'prose',
              text: "Last week was the strongest revenue week of the quarter — Acme's renewal and Halberd's expansion together added $180K of new ARR, pulling you above the $2.4M line for the first time. Underneath the revenue, activation softened: the new onboarding test cohort underperforms control by 8 points and has done so three weeks running.",
            },
            {
              kind: 'timeseries',
              caption: 'Day-7 activation, last 4 weeks',
              y_axis_label: 'Day-7 activation (%)',
              x_axis_label: 'Week ending',
              series: [
                { name: 'Test cohort', points: [{ t: '2026-04-12T00:00:00-07:00', y: 50.1 }, { t: '2026-04-19T00:00:00-07:00', y: 48.4 }, { t: '2026-04-26T00:00:00-07:00', y: 45.2 }, { t: '2026-05-03T00:00:00-07:00', y: 42.0 }] },
                { name: 'Control', points: [{ t: '2026-04-12T00:00:00-07:00', y: 49.8 }, { t: '2026-04-19T00:00:00-07:00', y: 50.2 }, { t: '2026-04-26T00:00:00-07:00', y: 50.0 }, { t: '2026-05-03T00:00:00-07:00', y: 49.6 }] },
              ],
            },
            {
              kind: 'prose',
              text: "Takeaway: a strong revenue week riding on two named accounts, one product signal worth investigating before Wednesday, and a Series A decision that will set the next two weeks of priorities.",
            },
          ],
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
    {
      label: 'Prose-only brief (no chart needed)',
      teaches: "report.brief works with prose blocks only — don't force a chart when the story is qualitative",
      component: {
        id: 'hiring-brief-2026-05-09',
        diary_date: '2026-05-09',
        section: 'on_the_desk',
        headline: 'Hiring — where things stand',
        anchor_refs: [],
        content: {
          blocks: [
            {
              kind: 'prose',
              text: "Three roles are in process. The engineering lead offer is ready and needs to go out this week — Jordan's competing offer closes Friday. The product designer panel is stalled; two interviewers haven't submitted feedback after 5 days, which is unusual and worth a nudge before the candidate loses interest.",
            },
            {
              kind: 'prose',
              text: "Head of Sales is on track — final round is Wednesday and the candidate is warm. If Jordan accepts, you'll have two new hires starting in June, which changes your Q3 onboarding load. If Jordan passes, the eng search restarts and the Q3 plan needs a rethink.",
            },
          ],
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
  ],
});
