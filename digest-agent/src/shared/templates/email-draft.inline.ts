/**
 * email-draft.inline — the diary's outbound-email template.
 *
 * Every email draft the principal sees comes through this single template.
 * The renderable shape is: a short paraphrased `context_summary` in your
 * voice (who reached out, what about, and everything else the principal
 * needs to recall), then the composed draft (subject + body + recipients).
 *
 * Do NOT paste the prior message verbatim. Paraphrase from everything you
 * know about the matter — prior threads, related commitments, relationship
 * state. The principal reads `context_summary` to remember why this draft
 * exists; they read `body` to decide whether to send it as-is.
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

export const emailDraftInlineContentSchema = z
  .object({
    context_summary: z
      .string()
      .min(40)
      .max(1500)
      .describe(
        "Short narrative paragraph in your voice. Lead with attribution (\"Marcus wrote you about X\"). Paraphrase the matter and pull in surrounding context from everywhere you know — not just the prior message. This is the principal's recall cue before they review the draft. Do not quote source verbatim.",
      ),
    to: z
      .array(z.string().email())
      .min(1)
      .max(20)
      .describe('Recipient email addresses. Always at least one.'),
    cc: z
      .array(z.string().email())
      .max(20)
      .optional()
      .describe('Optional CC list.'),
    subject: z
      .string()
      .min(1)
      .max(200)
      .describe('Subject line. Concrete, scannable. No "Re: Re: Re:" chains.'),
    body: z
      .string()
      .min(20)
      .max(4000)
      .describe(
        "The drafted body. Principal voice per profile.md (e.g. lowercase greetings, no 'circling back'). Every concrete claim must be grounded in source — fabricated facts are a hard fail.",
      ),
    thread_ref: z
      .string()
      .optional()
      .describe('Source thread id if this is a reply (e.g. gmail thread id).'),
  })
  .strict();

export const emailDraftInline = defineTemplate({
  templateId: 'email-draft.inline' as const,
  type: 'email-draft' as const,
  summary:
    "A send-ready email draft with a paraphrased context summary above it. The principal reads the summary to recall the matter, then the draft to decide whether to send.",
  voice:
    "context_summary is in your voice — paraphrase, never quote. Pull in everything you know about the subject and the matter, not just the prior message. The draft body itself uses the principal's voice per profile.md, with every claim grounded in source.",
  contentSchema: emailDraftInlineContentSchema,
  actionKinds: ['send_email'],
  goodExample: {
    id: 'reply-marcus-cap-table-2026-05-01',
    diary_date: '2026-05-01',
    section: 'right_now',
    headline: 'Reply to Marcus: cap table question',
    rationale:
      "Marcus has been waiting since Tuesday. Quick directional answer now, fuller treatment after the Series A close.",
    anchor_refs: ['marcus_webb'],
    content: {
      context_summary:
        "Marcus asked Tuesday how the new option pool refresh interacts with existing common at the Series A close. He has been mapping his own equity question since the term sheet landed last week, and you'd already promised him a walkthrough after close. Background: Marcus is your earliest hire (anchor since 2024), holds 1.4% on a 4-year vest with one year cliffed, and is the only ICs on the cap table without a refresh of his own pending. His tone in the thread is calm; he's not pressing for a decision, just understanding.",
      to: ['marcus@halberd.com'],
      subject: 'Re: cap table after the round',
      body: "marcus — short answer is yes, the option pool refreshes pre-money, so existing common dilutes proportionally with the new pool plus the round itself. happy to walk through the deck next week — i'll have a cleaner table by then.",
      thread_ref: 'gmail:thread_d12_marcus_cap_table',
    },
    actions: [{ id: 'send', label: 'Send', kind: 'send_email' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Warm investor reply',
      teaches: 'full context_summary on a P0 anchor; calm unhurried body; sign-off with first name only',
      component: {
        id: 'reply-marcus-cap-table-2026-05-01',
        diary_date: '2026-05-01',
        section: 'right_now',
        headline: 'Reply to Marcus: cap table question',
        rationale: 'Marcus has been waiting since Tuesday. Quick directional answer now, fuller treatment after the Series A close.',
        anchor_refs: ['marcus_webb'],
        content: {
          context_summary:
            "Marcus asked Tuesday how the new option pool refresh interacts with existing common at the Series A close. He has been mapping his own equity question since the term sheet landed last week, and you'd already promised him a walkthrough after close. Background: Marcus is your earliest hire (anchor since 2024), holds 1.4% on a 4-year vest with one year cliffed, and is the only IC on the cap table without a refresh of his own pending. His tone in the thread is calm; he's not pressing for a decision, just understanding.",
          to: ['marcus@halberd.com'],
          subject: 'Re: cap table after the round',
          body: "marcus — short answer is yes, the option pool refreshes pre-money, so existing common dilutes proportionally with the new pool plus the round itself. happy to walk through the deck next week — i'll have a cleaner table by then.",
          thread_ref: 'gmail:thread_d12_marcus_cap_table',
        },
        actions: [{ id: 'send', label: 'Send', kind: 'send_email' }],
        status: 'open',
      },
    },
    {
      label: 'Curt vendor decline',
      teaches: 'terse body with no greeting; no rationale needed; draft in 1 sentence',
      component: {
        id: 'decline-acme-upsell-2026-05-03',
        diary_date: '2026-05-03',
        section: 'on_the_desk',
        headline: 'Decline Acme upsell pitch',
        anchor_refs: [],
        content: {
          context_summary:
            "Acme's account manager sent a third upsell email for their enterprise tier. The prior two went unanswered. The substrate has no Acme anchor — they're a cold vendor with no existing relationship. Declining directly is faster than continued silence.",
          to: ['sales@acme-corp.io'],
          subject: 'Re: Acme enterprise tier',
          body: "thanks — not the right time. please remove me from this sequence.",
          thread_ref: 'gmail:thread_acme_upsell_3',
        },
        actions: [{ id: 'send', label: 'Send', kind: 'send_email' }],
        status: 'open',
      },
    },
    {
      label: 'Apologetic late commitment',
      teaches: 'body that owns the delay without over-apologizing; specific re-commit with date',
      component: {
        id: 'late-renee-case-study-brief-2026-05-05',
        diary_date: '2026-05-05',
        section: 'on_the_desk',
        headline: 'Send Renee the case study sign-off',
        rationale: 'Promised Friday; today is Monday. One sentence owning the delay, then the answer.',
        anchor_refs: ['renee_tan'],
        content: {
          context_summary:
            "Renee sent the case study brief Friday and asked for your sign-off on the customer order before she starts drafts. You were supposed to reply by EOD Friday; it's now Monday morning. She hasn't chased yet but the kickoff is Wednesday.",
          to: ['renee@halberd.com'],
          subject: 'Re: case study brief — customer order',
          body: "renee — sorry for the delay. yes to the order as you proposed: halberd first, then holdfast, then bench. lmk if that conflicts with anything on your end.",
          thread_ref: 'gmail:thread_renee_case_study_brief',
        },
        actions: [{ id: 'send', label: 'Send', kind: 'send_email' }],
        status: 'open',
      },
    },
  ],
});
