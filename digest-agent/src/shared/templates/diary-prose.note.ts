/**
 * diary-prose.note — paraphrased prose, in the diary's own voice.
 *
 * Replaces the old "doc-tile" surface. If something is worth knowing but
 * doesn't itself need a HITL action, write it as a short narrative — the
 * way someone keeps a diary: "Maya sent over the brief", "Marcus has been
 * quiet since Tuesday", "the migration RFC landed and the prod plan
 * changed". Lead with attribution. Pull from across the substrate.
 *
 * Use this template when:
 *   - There is no decision to make and no draft to send.
 *   - But the principal benefits from knowing the matter today.
 *
 * Don't use this template when:
 *   - The matter genuinely deserves a HITL surface — pick the right one
 *     (email-draft, calendar-block, choose-one, free-text-reply).
 *   - The matter is too important to read as ambient prose — use
 *     diary-prose.flash instead.
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

export const diaryProseNoteContentSchema = z
  .object({
    text: z
      .string()
      .min(40)
      .max(2000)
      .describe(
        "The paraphrased note in your voice. Lead with attribution (\"Maya sent over the case-study brief\", \"Marcus replied late last night\"). Then synthesize what the principal needs to know — pull in prior threads, related commitments, relationship state. Reads like a diary entry, not a doc abstract. Do not quote source verbatim; paraphrase from everything you know.",
      ),
  })
  .strict();

export const diaryProseNote = defineTemplate({
  templateId: 'diary-prose.note' as const,
  type: 'diary-prose' as const,
  summary:
    'A paraphrased prose note. The diary narrating, in its own voice, something worth knowing.',
  voice:
    "Diary voice. Past tense for things that happened, second person for things the principal might do. Concrete and specific — name the person, the matter, what changed. Pull context from across the substrate; do not just summarize the immediate source.",
  contentSchema: diaryProseNoteContentSchema,
  actionKinds: ['dismiss'],
  goodExample: {
    id: 'note-maya-brief-2026-05-01',
    diary_date: '2026-05-01',
    section: 'tracking',
    headline: 'Maya sent the case-study brief',
    anchor_refs: ['maya_chen'],
    content: {
      text: "Maya sent over the case-study brief late Friday — three customers (Halberd, Holdfast, Bench), 800-word target each, draft due by 5/15. She wants your sign-off on the customer order before Renee starts, since you'd previously flagged Halberd's confidentiality terms as the tightest. Renee starts Monday and the kickoff is on her calendar; the brief sits in the same Notion as last quarter's drafts.",
    },
    actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Synthesis across substrate',
      teaches: 'pull context from multiple anchors and prior threads, not just the immediate source',
      component: {
        id: 'note-maya-brief-2026-05-01',
        diary_date: '2026-05-01',
        section: 'tracking',
        headline: 'Maya sent the case-study brief',
        anchor_refs: ['maya_chen'],
        content: {
          text: "Maya sent over the case-study brief late Friday — three customers (Halberd, Holdfast, Bench), 800-word target each, draft due by 5/15. She wants your sign-off on the customer order before Renee starts, since you'd previously flagged Halberd's confidentiality terms as the tightest. Renee starts Monday and the kickoff is on her calendar; the brief sits in the same Notion as last quarter's drafts.",
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
    {
      label: 'Terse observation',
      teaches: 'one-sentence body when the matter is simple; no over-explaining',
      component: {
        id: 'note-deploy-green-2026-05-05',
        diary_date: '2026-05-05',
        section: 'tracking',
        headline: 'Halberd migration deployed — green',
        anchor_refs: ['halberd'],
        content: {
          text: 'The Q2 migration shipped overnight; all health checks are green. No action needed — noting because you asked to be kept in the loop.',
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
    {
      label: 'Contradiction flag',
      teaches: "surface two sources that disagree — don't pick one and hide the other",
      component: {
        id: 'note-marcus-meeting-conflict-2026-05-06',
        diary_date: '2026-05-06',
        section: 'on_the_desk',
        headline: "Calendar and email disagree about the Marcus meeting",
        anchor_refs: ['marcus_webb'],
        content: {
          text: "Calendar shows your Marcus check-in on Thursday 4pm. His email Wednesday confirmed he moved it to Monday 10am. I haven't reconciled — confirm with Marcus before either of you walks into the wrong slot.",
        },
        actions: [{ id: 'dismiss', label: 'Got it', kind: 'dismiss' }],
        status: 'open',
      },
    },
  ],
});
