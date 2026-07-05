<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/email-draft.inline.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `email-draft.inline` (`type: email-draft`)

MCP tool: `write_email_draft_inline`

A send-ready email draft with a paraphrased context summary above it. The principal reads the summary to recall the matter, then the draft to decide whether to send.

**Voice.** context_summary is in your voice — paraphrase, never quote. Pull in everything you know about the subject and the matter, not just the prior message. The draft body itself uses the principal's voice per profile.md, with every claim grounded in source.

**`action.kind` values:** `send_email`

**Content fields:**

- `context_summary`: `string` (40–1500 chars) — Short narrative paragraph in your voice. Lead with attribution ("Marcus wrote you about X"). Paraphrase the matter and pull in surrounding context from everywhere you know — not just the prior message. This is the principal's recall cue before they review the draft. Do not quote source verbatim.
- `to`: `string[]` — Recipient email addresses. Always at least one.
- `cc`: `string[]` *(optional)* — Optional CC list.
- `subject`: `string` (1–200 chars) — Subject line. Concrete, scannable. No "Re: Re: Re:" chains.
- `body`: `string` (20–4000 chars) — The drafted body. Principal voice per profile.md (e.g. lowercase greetings, no 'circling back'). Every concrete claim must be grounded in source — fabricated facts are a hard fail.
- `thread_ref`: `string` *(optional)* — Source thread id if this is a reply (e.g. gmail thread id).

## Example calls

### Warm investor reply *(teaches: full context_summary on a P0 anchor; calm unhurried body; sign-off with first name only)*

```json
{
  "date": "2026-05-01",
  "id": "reply-marcus-cap-table-2026-05-01",
  "section": "right_now",
  "headline": "Reply to Marcus: cap table question",
  "rationale": "Marcus has been waiting since Tuesday. Quick directional answer now, fuller treatment after the Series A close.",
  "anchor_refs": [
    "marcus_webb"
  ],
  "content": {
    "context_summary": "Marcus asked Tuesday how the new option pool refresh interacts with existing common at the Series A close. He has been mapping his own equity question since the term sheet landed last week, and you'd already promised him a walkthrough after close. Background: Marcus is your earliest hire (anchor since 2024), holds 1.4% on a 4-year vest with one year cliffed, and is the only IC on the cap table without a refresh of his own pending. His tone in the thread is calm; he's not pressing for a decision, just understanding.",
    "to": [
      "marcus@halberd.com"
    ],
    "subject": "Re: cap table after the round",
    "body": "marcus — short answer is yes, the option pool refreshes pre-money, so existing common dilutes proportionally with the new pool plus the round itself. happy to walk through the deck next week — i'll have a cleaner table by then.",
    "thread_ref": "gmail:thread_d12_marcus_cap_table"
  },
  "actions": [
    {
      "id": "send",
      "label": "Send",
      "kind": "send_email"
    }
  ]
}
```

### Curt vendor decline *(teaches: terse body with no greeting; no rationale needed; draft in 1 sentence)*

```json
{
  "date": "2026-05-03",
  "id": "decline-acme-upsell-2026-05-03",
  "section": "on_the_desk",
  "headline": "Decline Acme upsell pitch",
  "anchor_refs": [],
  "content": {
    "context_summary": "Acme's account manager sent a third upsell email for their enterprise tier. The prior two went unanswered. The substrate has no Acme anchor — they're a cold vendor with no existing relationship. Declining directly is faster than continued silence.",
    "to": [
      "sales@acme-corp.io"
    ],
    "subject": "Re: Acme enterprise tier",
    "body": "thanks — not the right time. please remove me from this sequence.",
    "thread_ref": "gmail:thread_acme_upsell_3"
  },
  "actions": [
    {
      "id": "send",
      "label": "Send",
      "kind": "send_email"
    }
  ]
}
```

### Apologetic late commitment *(teaches: body that owns the delay without over-apologizing; specific re-commit with date)*

```json
{
  "date": "2026-05-05",
  "id": "late-renee-case-study-brief-2026-05-05",
  "section": "on_the_desk",
  "headline": "Send Renee the case study sign-off",
  "rationale": "Promised Friday; today is Monday. One sentence owning the delay, then the answer.",
  "anchor_refs": [
    "renee_tan"
  ],
  "content": {
    "context_summary": "Renee sent the case study brief Friday and asked for your sign-off on the customer order before she starts drafts. You were supposed to reply by EOD Friday; it's now Monday morning. She hasn't chased yet but the kickoff is Wednesday.",
    "to": [
      "renee@halberd.com"
    ],
    "subject": "Re: case study brief — customer order",
    "body": "renee — sorry for the delay. yes to the order as you proposed: halberd first, then holdfast, then bench. lmk if that conflicts with anything on your end.",
    "thread_ref": "gmail:thread_renee_case_study_brief"
  },
  "actions": [
    {
      "id": "send",
      "label": "Send",
      "kind": "send_email"
    }
  ]
}
```

