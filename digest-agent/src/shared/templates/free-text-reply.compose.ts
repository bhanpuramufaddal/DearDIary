/**
 * free-text-reply.compose — open-ended composition. The principal writes a
 * message in a textarea; the execution agent dispatches via whatever
 * action.kind selects (slack_send, email_send_inline, sms_send, etc.).
 *
 * Use this when:
 *   - The agent CAN'T responsibly draft (e.g. high-stakes, profile.md forbids
 *     drafting for partner-type relationships).
 *   - The principal asked for "let me write this one."
 *   - It's a quick informal touch where a draft would feel pre-canned.
 *
 * Don't use for:
 *   - Anything the agent CAN draft well — use the relevant draft template.
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

export const freeTextReplyComposeContentSchema = z
  .object({
    prompt: z
      .string()
      .min(10)
      .max(400)
      .describe(
        'What the principal is being asked to write. Frame it like a colleague briefing them, not as a question.',
      ),
    placeholder: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Textarea placeholder hint. Short, no full sentences (e.g. "two lines, casual tone").',
      ),
    to: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Recipient context shown in meta line (e.g. 'Marcus' or 'team@halberd.com').",
      ),
    channel: z
      .string()
      .max(80)
      .optional()
      .describe('Channel hint (e.g. "#eng" for slack, "email" for mail).'),
  })
  .strict();

export const freeTextReplyCompose = defineTemplate({
  templateId: 'free-text-reply.compose' as const,
  type: 'free-text-reply' as const,
  summary:
    'Open textarea — the principal writes the reply themselves; agent dispatches.',
  voice:
    'The prompt orients the principal in 1-2 sentences: who, the relevant context, the tone that fits. Hand them a frame, not a blank field.',
  contentSchema: freeTextReplyComposeContentSchema,
  actionKinds: ['slack_send', 'email_send_inline', 'sms_send'],
  goodExample: {
    id: 'checkin-marcus-quiet-2026-05-04',
    diary_date: '2026-05-04',
    section: 'on_the_desk',
    headline: 'Check in with Marcus',
    rationale:
      "Last reply was Tuesday's cap-table question. Profile.md says draft for Marcus is off-limits — but a friendly nudge is yours.",
    anchor_refs: ['marcus_webb'],
    content: {
      prompt:
        'Marcus has been quiet since Tuesday. Two-liner — friendly, no agenda. He responds well to brevity.',
      placeholder: '2 lines, casual',
      to: 'Marcus',
      channel: 'slack:@marcus',
    },
    actions: [{ id: 'send_slack', label: 'Send via Slack', kind: 'slack_send' }],
    status: 'open',
  },
  examples: [
    {
      label: 'Partner check-in (drafting forbidden)',
      teaches: "use free-text when profile.md forbids drafting — give context + frame, not blank field",
      component: {
        id: 'checkin-marcus-quiet-2026-05-04',
        diary_date: '2026-05-04',
        section: 'on_the_desk',
        headline: 'Check in with Marcus',
        rationale: "Last reply was Tuesday's cap-table question. Profile.md says draft for Marcus is off-limits — but a friendly nudge is yours.",
        anchor_refs: ['marcus_webb'],
        content: {
          prompt: 'Marcus has been quiet since Tuesday. Two-liner — friendly, no agenda. He responds well to brevity.',
          placeholder: '2 lines, casual',
          to: 'Marcus',
          channel: 'slack:@marcus',
        },
        actions: [{ id: 'send_slack', label: 'Send via Slack', kind: 'slack_send' }],
        status: 'open',
      },
    },
    {
      label: 'High-stakes reply (relationship too sensitive to ghost-write)',
      teaches: "when the relationship history is thin, surface the matter and let the principal write — explain why in rationale",
      component: {
        id: 'reply-board-member-question-2026-05-11',
        diary_date: '2026-05-11',
        section: 'on_the_desk',
        headline: "Reply to Patricia re: Q2 hiring plan",
        rationale: "Board member; relationship is 4 months old. The question is substantive and I don't have enough of your observed voice in board-member threads to draft safely. Better in your own words.",
        anchor_refs: ['patricia_osei'],
        content: {
          prompt: "Patricia asked for your thinking on the Q2 engineering hiring plan before Thursday's board call. She wants 2–3 sentences, not a doc. Keep it confident; she responds well to directness.",
          placeholder: '2-3 sentences, confident',
          to: 'Patricia',
          channel: 'email',
        },
        actions: [{ id: 'send', label: 'Send', kind: 'email_send_inline' }],
        status: 'open',
      },
    },
  ],
});
