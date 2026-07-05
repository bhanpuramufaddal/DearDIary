/**
 * calendar-block.decision — an inbound calendar invite or scheduling decision.
 * Renders when/who/where with accept/decline/propose affordances.
 *
 * Use this when:
 *   - An invite landed and the principal needs to decide (accept/decline/propose).
 *
 * Don't use for:
 *   - Outgoing invites you're composing → use calendar-invite.send.
 *   - "FYI you have a meeting later" surfaces → use diary-prose.note or
 *     calendar-prep (for richer briefing).
 */

import { z } from 'zod';
import { defineTemplate } from './_helpers.ts';

export const calendarBlockDecisionContentSchema = z
  .object({
    when_iso: z
      .string()
      .datetime({ offset: true })
      .describe('Event start time, ISO 8601 with offset (e.g. 2026-05-02T15:00:00-07:00).'),
    when_label: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Optional human-readable label ('Sat May 2, 3pm PT'). The renderer formats from when_iso if omitted.",
      ),
    duration_min: z
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .describe('Event duration in minutes.'),
    with: z
      .array(z.string().min(1).max(120))
      .max(20)
      .optional()
      .describe('Attendees as display names or addresses. Omit for solo events.'),
    location: z
      .string()
      .max(300)
      .optional()
      .describe('Physical address, room name, or video link.'),
    summary: z
      .string()
      .min(20)
      .max(600)
      .describe(
        '2–3 sentences in principal voice. What the meeting is for and what the decision hinges on.',
      ),
  })
  .strict();

export const calendarBlockDecision = defineTemplate({
  templateId: 'calendar-block.decision' as const,
  type: 'calendar-block' as const,
  summary: 'Inbound calendar invite needing accept/decline/propose decision.',
  voice:
    'The summary carries the decision context — what this meeting is for and what hinges on the principal\'s answer. Metadata (time, attendees, location) renders separately.',
  contentSchema: calendarBlockDecisionContentSchema,
  actionKinds: ['accept', 'decline', 'propose'],
  goodExample: {
    id: 'calendar-renee-strategy-2026-05-02',
    diary_date: '2026-05-02',
    section: 'on_the_desk',
    headline: 'Renee Tan: strategy sit-down',
    rationale:
      "First face-time with Renee on Q2 case studies. 30 min sets the tone for the next 6 weeks of work.",
    anchor_refs: ['renee_tan'],
    content: {
      when_iso: '2026-05-04T15:00:00-07:00',
      when_label: 'Mon May 4, 3pm PT',
      duration_min: 30,
      with: ['Renee Tan', 'Maya Chen'],
      location: 'https://meet.example/holdfast-strategy',
      summary:
        "First sit-down since Renee joined. Wants strategic input on the case-studies arc before drafting begins. Maya will be on too.",
    },
    actions: [
      { id: 'accept', label: 'Accept', kind: 'accept' },
      { id: 'decline', label: 'Decline', kind: 'decline' },
      { id: 'propose', label: 'Propose another time', kind: 'propose' },
    ],
    status: 'open',
  },
  examples: [
    {
      label: 'Non-trivial invite (new relationship)',
      teaches: 'summary explains what the meeting is FOR, not just who and when; rationale names the stakes',
      component: {
        id: 'calendar-renee-strategy-2026-05-02',
        diary_date: '2026-05-02',
        section: 'on_the_desk',
        headline: 'Renee Tan: strategy sit-down',
        rationale: "First face-time with Renee on Q2 case studies. 30 min sets the tone for the next 6 weeks of work.",
        anchor_refs: ['renee_tan'],
        content: {
          when_iso: '2026-05-04T15:00:00-07:00',
          when_label: 'Mon May 4, 3pm PT',
          duration_min: 30,
          with: ['Renee Tan', 'Maya Chen'],
          location: 'https://meet.example/holdfast-strategy',
          summary: "First sit-down since Renee joined. Wants strategic input on the case-studies arc before drafting begins. Maya will be on too.",
        },
        actions: [
          { id: 'accept', label: 'Accept', kind: 'accept' },
          { id: 'decline', label: 'Decline', kind: 'decline' },
          { id: 'propose', label: 'Propose another time', kind: 'propose' },
        ],
        status: 'open',
      },
    },
    {
      label: 'Conflicted invite (propose)',
      teaches: 'when the invite conflicts with something existing, the summary names the conflict so the principal can decide',
      component: {
        id: 'calendar-board-pre-read-conflict-2026-05-10',
        diary_date: '2026-05-10',
        section: 'on_the_desk',
        headline: 'Board pre-read conflicts with the Series A closing call',
        rationale: "Board pre-read is mandatory but the closing call can't move. Propose a 30-min shift.",
        anchor_refs: [],
        content: {
          when_iso: '2026-05-12T14:00:00-07:00',
          when_label: 'Tue May 12, 2pm PT',
          duration_min: 60,
          with: ['Board members', 'Maya Chen'],
          summary: "The pre-read overlaps your 2–3pm closing call with counsel. You can accept if you move the pre-read to 1pm or 3:30pm — both are clear on your calendar.",
        },
        actions: [
          { id: 'accept', label: 'Accept as-is', kind: 'accept' },
          { id: 'propose', label: 'Propose 1pm or 3:30pm', kind: 'propose' },
          { id: 'decline', label: 'Decline', kind: 'decline' },
        ],
        status: 'open',
      },
    },
  ],
});
