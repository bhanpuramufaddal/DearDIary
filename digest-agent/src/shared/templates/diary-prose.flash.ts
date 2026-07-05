/**
 * diary-prose.flash — urgent paraphrased prose.
 *
 * The "you need to see this right now" surface. Same shape as
 * diary-prose.note, different voice + renderer treatment (loud
 * typography). Reserved for genuine right-now matters.
 *
 * Use this template when:
 *   - The matter would be a meaningful loss if the principal didn't notice
 *     it today: a deal said no, an investor wants to talk before noon,
 *     a deadline moved.
 *   - The matter doesn't itself have a single right action (otherwise pick
 *     the right HITL template — flash is for awareness, not decision).
 *
 * Don't use this template when:
 *   - The matter belongs in the calmer diary-prose.note surface — almost
 *     everything does. Flash is rare.
 *
 * Discipline. At most 1–2 flash components per day. If you find yourself
 * about to write a third, downgrade two of them to diary-prose.note —
 * the surface only works because it is rare.
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

export const diaryProseFlashContentSchema = z
  .object({
    text: z
      .string()
      .min(20)
      .max(800)
      .describe(
        'Urgent paraphrased prose in your voice. Lead with the one-line that lands in two seconds ("Marcus said no", "Investor wants to talk before noon"). Then 1–3 sentences of what they need to know and, if applicable, what to attend to right now. Tight.',
      ),
  })
  .strict();

export const diaryProseFlash = defineTemplate({
  templateId: 'diary-prose.flash' as const,
  type: 'diary-prose' as const,
  summary:
    'Urgent paraphrased prose — the "you should see this right now" surface. At most 1–2 per day.',
  voice:
    "Direct, declarative, no buildup. The first sentence carries the whole signal. The body is what to attend to — not what to do (HITL templates own \"what to do\"). If you are tempted to use flash for something that is not, in fact, urgent — write a diary-prose.note instead.",
  contentSchema: diaryProseFlashContentSchema,
  actionKinds: ['dismiss'],
  goodExample: {
    id: 'flash-marcus-no-2026-05-04',
    diary_date: '2026-05-04',
    section: 'right_now',
    headline: 'Marcus said no',
    anchor_refs: ['marcus_webb'],
    content: {
      text: 'Marcus replied at 11:47pm: he is passing on the Series A. He cited the option-pool refresh question you walked through Friday — said the post-refresh dilution math no longer works for his existing common. He framed it as final but warm. Two other term sheets are still live; Maya will know first.',
    },
    actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Bad news (deal outcome)',
      teaches: 'lead with the one-line that lands in two seconds; body is context, not action steps',
      component: {
        id: 'flash-marcus-no-2026-05-04',
        diary_date: '2026-05-04',
        section: 'right_now',
        headline: 'Marcus said no',
        anchor_refs: ['marcus_webb'],
        content: {
          text: 'Marcus replied at 11:47pm: he is passing on the Series A. He cited the option-pool refresh question you walked through Friday — said the post-refresh dilution math no longer works for his existing common. He framed it as final but warm. Two other term sheets are still live; Maya will know first.',
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
    {
      label: 'Urgent positive (time window)',
      teaches: 'flash is also right for urgent-good news with a narrow window, not just bad news',
      component: {
        id: 'flash-term-sheet-2026-05-07',
        diary_date: '2026-05-07',
        section: 'right_now',
        headline: "Inflection Point's term sheet is in your inbox",
        anchor_refs: ['inflection_point_ventures'],
        content: {
          text: "The term sheet landed at 6:04am. Marcus says the partner meeting is Thursday and they'd like a verbal yes before noon today to hold the slot. Two other firms are still in process.",
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
    {
      label: 'Conflict alert (calendar)',
      teaches: "flash when a conflict has a real consequence today — not just 'you have two meetings'",
      component: {
        id: 'flash-wren-doctor-clash-2026-05-08',
        diary_date: '2026-05-08',
        section: 'right_now',
        headline: "Wren's 3pm doctor appointment clashes with the Series A closing call",
        anchor_refs: [],
        content: {
          text: "Sam added Wren's pediatrician at 3pm today. Your closing call with counsel is also 3–4pm — you can't move the closing call. Sam doesn't know yet.",
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
  ],
});
