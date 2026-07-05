/**
 * chart.timeseries — line/area chart over time.
 *
 * One or more numeric series indexed by timestamp. The story is the trend,
 * not the latest value. The context_summary names the trend ("activation
 * has softened three weeks in a row") so the principal reads the paragraph
 * even if they don't study the chart.
 *
 * Use this template when:
 *   - The matter is a trajectory: growth, decay, a soft cliff.
 *
 * Don't use this template when:
 *   - One latest number dominates — use big-number.metric.
 *   - The comparison is categorical, not temporal — use chart.bar.
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

const pointSchema = z
  .object({
    t: z
      .string()
      .datetime({ offset: true })
      .describe('X-axis timestamp, ISO 8601 with offset.'),
    y: z.number().describe('Numeric value at this time.'),
  })
  .strict();

const seriesSchema = z
  .object({
    name: z.string().min(1).max(80).describe('Series label shown in the legend.'),
    points: z.array(pointSchema).min(2).max(500),
  })
  .strict();

export const chartTimeseriesContentSchema = z
  .object({
    context_summary: z
      .string()
      .min(40)
      .max(1500)
      .describe(
        "Paraphrased context in your voice. Name the trend the chart tells (\"activation has softened three weeks in a row\"). Do not narrate axes — the renderer shows them.",
      ),
    y_axis_label: z.string().min(1).max(80).describe('What the y-axis measures.'),
    x_axis_label: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe('Optional x-axis label. Renderer defaults to dates if omitted.'),
    series: z
      .array(seriesSchema)
      .min(1)
      .max(4)
      .describe('Between 1 and 4 series. Order from most to least important.'),
  })
  .strict();

export const chartTimeseries = defineTemplate({
  templateId: 'chart.timeseries' as const,
  type: 'chart' as const,
  summary: 'Line/area chart over time with a paraphrased context paragraph naming the trend.',
  voice:
    "The chart shows the shape; the context_summary names the story. Lead the summary with the trend the principal should notice; do not list datapoints.",
  contentSchema: chartTimeseriesContentSchema,
  actionKinds: ['dismiss'],
  goodExample: {
    id: 'activation-trend-2026-05-04',
    diary_date: '2026-05-04',
    section: 'on_the_desk',
    headline: 'Activation softening, three weeks running',
    rationale: 'The onboarding-test cohort underperforms; trend deserves a look.',
    anchor_refs: [],
    content: {
      context_summary:
        "Day-7 activation has softened three weeks in a row, from 50% to 42%. The fall started the week the new onboarding test cohort went live; the control cohort held flat near 50%. If the next cohort (Wed) repeats the pattern, the test is your prime suspect and you would want to pause it before rolling further.",
      y_axis_label: 'Day-7 activation',
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
    actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Diverging series (test vs control)',
      teaches: 'context_summary names the divergence and what to do about it — not a description of the axes',
      component: {
        id: 'activation-trend-2026-05-04',
        diary_date: '2026-05-04',
        section: 'on_the_desk',
        headline: 'Activation softening, three weeks running',
        rationale: 'The onboarding-test cohort underperforms; trend deserves a look.',
        anchor_refs: [],
        content: {
          context_summary:
            "Day-7 activation has softened three weeks in a row, from 50% to 42%. The fall started the week the new onboarding test cohort went live; the control cohort held flat near 50%. If the next cohort (Wed) repeats the pattern, the test is your prime suspect and you would want to pause it before rolling further.",
          y_axis_label: 'Day-7 activation',
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
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
    {
      label: 'Single-series growth trend',
      teaches: 'one series is fine when the story is about trajectory, not comparison',
      component: {
        id: 'arr-growth-trend-2026-05-06',
        diary_date: '2026-05-06',
        section: 'tracking',
        headline: 'ARR growing steadily — 8 weeks',
        anchor_refs: [],
        content: {
          context_summary:
            "ARR has grown consistently over 8 weeks — no single large spike, which is the healthy sign: it's net expansion from existing accounts, not lumpy new logos.",
          y_axis_label: 'ARR ($)',
          x_axis_label: 'Week ending',
          series: [
            {
              name: 'ARR',
              points: [
                { t: '2026-03-08T00:00:00-07:00', y: 1900000 },
                { t: '2026-03-15T00:00:00-07:00', y: 1970000 },
                { t: '2026-03-22T00:00:00-07:00', y: 2040000 },
                { t: '2026-03-29T00:00:00-07:00', y: 2100000 },
                { t: '2026-04-05T00:00:00-07:00', y: 2170000 },
                { t: '2026-04-12T00:00:00-07:00', y: 2220000 },
                { t: '2026-04-19T00:00:00-07:00', y: 2310000 },
                { t: '2026-04-26T00:00:00-07:00', y: 2400000 },
              ],
            },
          ],
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
  ],
});
