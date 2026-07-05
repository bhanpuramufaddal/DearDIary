/**
 * choose-one.cards — a forced multi-option pick. The principal selects one
 * card; tapping Confirm carries `principal_input.option_id`.
 *
 * Use this when:
 *   - There's a clean N-way choice (2–5 options) and the principal's pick
 *     drives downstream work.
 *   - Examples: "which of these 3 meetings to keep next week?", "which draft
 *     do you want to send?".
 *
 * Don't use for:
 *   - Heavy decisions with risk/tradeoff per option → use decision-pending.
 *   - Binary approve/reject → use approval-request (richer framing).
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

export const chooseOneCardsContentSchema = z
  .object({
    prompt: z
      .string()
      .min(10)
      .max(400)
      .describe('The question the principal is answering. 1–2 sentences.'),
    options: z
      .array(
        z
          .object({
            id: z
              .string()
              .min(1)
              .max(64)
              .describe('Stable option id, kebab-case. Carried in principal_input.option_id.'),
            label: z
              .string()
              .min(1)
              .max(120)
              .describe('Short label shown on the card (e.g. "Keep Tuesday standup").'),
            detail: z
              .string()
              .max(400)
              .optional()
              .describe('Optional second line under the label — 1–2 sentences max.'),
          })
          .strict(),
      )
      .min(2)
      .max(5)
      .describe('Between 2 and 5 options. Mutually exclusive.'),
  })
  .strict();

export const chooseOneCards = defineTemplate({
  templateId: 'choose-one.cards' as const,
  type: 'choose-one' as const,
  summary: 'Forced multi-option pick (2–5 mutually exclusive cards).',
  voice:
    "The prompt frames the choice concretely (\"Which gets your hours this week?\"). Option labels stay tight; detail lines explain why each is worth considering, in neutral terms.",
  contentSchema: chooseOneCardsContentSchema,
  actionKinds: ['confirm_option'],
  goodExample: {
    id: 'pick-week-priority-2026-05-03',
    diary_date: '2026-05-03',
    section: 'right_now',
    headline: 'One priority for this week',
    rationale:
      "You can't do all three well. Pick the one that gets your attention; the others slip honestly.",
    anchor_refs: [],
    content: {
      prompt: 'Three things compete this week. Which gets your hours?',
      options: [
        {
          id: 'series_a_close',
          label: 'Close the Series A',
          detail:
            'Term sheet signed; counsel review due Friday. Marcus expects a final call by Wednesday.',
        },
        {
          id: 'case_studies_q2',
          label: 'Q2 case studies',
          detail: "Renee's first week — kickoff Monday, three drafts targeted for 5/15.",
        },
        {
          id: 'hire_engineering_lead',
          label: 'Hire the eng lead',
          detail:
            'Final-round Wednesday with Sam; offer needs to land by Friday or they take the other one.',
        },
      ],
    },
    actions: [{ id: 'confirm', label: 'Confirm pick', kind: 'confirm_option' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Weekly priority pick',
      teaches: 'prompt forces the tradeoff; detail lines name the cost of not picking this option',
      component: {
        id: 'pick-week-priority-2026-05-03',
        diary_date: '2026-05-03',
        section: 'right_now',
        headline: 'One priority for this week',
        rationale: "You can't do all three well. Pick the one that gets your attention; the others slip honestly.",
        anchor_refs: [],
        content: {
          prompt: 'Three things compete this week. Which gets your hours?',
          options: [
            { id: 'series_a_close', label: 'Close the Series A', detail: 'Term sheet signed; counsel review due Friday. Marcus expects a final call by Wednesday.' },
            { id: 'case_studies_q2', label: 'Q2 case studies', detail: "Renee's first week — kickoff Monday, three drafts targeted for 5/15." },
            { id: 'hire_engineering_lead', label: 'Hire the eng lead', detail: 'Final-round Wednesday with Sam; offer needs to land by Friday or they take the other one.' },
          ],
        },
        actions: [{ id: 'confirm', label: 'Confirm pick', kind: 'confirm_option' }],
        status: 'open',
      },
    },
    {
      label: 'Binary hire decision',
      teaches: 'two-option pick where both options are valid — agent stays neutral, no recommendation',
      component: {
        id: 'hire-offer-decide-2026-05-09',
        diary_date: '2026-05-09',
        section: 'on_the_desk',
        headline: 'Engineering lead offer — extend or pass?',
        rationale: 'Panel feedback converged. Waiting on your call; offer letter is ready to send.',
        anchor_refs: ['jordan_cole'],
        content: {
          prompt: "Jordan's panel is done. Both outcomes are defensible — your call.",
          options: [
            { id: 'extend', label: 'Extend offer', detail: 'Strong backend depth; culture fit was good. Offer letter is ready; start date can be June 2.' },
            { id: 'pass', label: 'Pass', detail: 'Two interviewers flagged communication style in distributed work. Risk is real if the team stays remote.' },
          ],
        },
        actions: [{ id: 'confirm', label: 'Confirm', kind: 'confirm_option' }],
        status: 'open',
      },
    },
  ],
});
