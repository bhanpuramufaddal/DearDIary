<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/free-text-reply.compose.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `free-text-reply.compose` (`type: free-text-reply`)

MCP tool: `write_free_text_reply_compose`

Open textarea — the principal writes the reply themselves; agent dispatches.

**Voice.** The prompt orients the principal in 1-2 sentences: who, the relevant context, the tone that fits. Hand them a frame, not a blank field.

**`action.kind` values:** `slack_send`, `email_send_inline`, `sms_send`

**Content fields:**

- `prompt`: `string` (10–400 chars) — What the principal is being asked to write. Frame it like a colleague briefing them, not as a question.
- `placeholder`: `string` (≤200 chars) *(optional)* — Textarea placeholder hint. Short, no full sentences (e.g. "two lines, casual tone").
- `to`: `string` (≤200 chars) *(optional)* — Recipient context shown in meta line (e.g. 'Marcus' or 'team@halberd.com').
- `channel`: `string` (≤80 chars) *(optional)* — Channel hint (e.g. "#eng" for slack, "email" for mail).

## Example calls

### Partner check-in (drafting forbidden) *(teaches: use free-text when profile.md forbids drafting — give context + frame, not blank field)*

```json
{
  "date": "2026-05-04",
  "id": "checkin-marcus-quiet-2026-05-04",
  "section": "on_the_desk",
  "headline": "Check in with Marcus",
  "rationale": "Last reply was Tuesday's cap-table question. Profile.md says draft for Marcus is off-limits — but a friendly nudge is yours.",
  "anchor_refs": [
    "marcus_webb"
  ],
  "content": {
    "prompt": "Marcus has been quiet since Tuesday. Two-liner — friendly, no agenda. He responds well to brevity.",
    "placeholder": "2 lines, casual",
    "to": "Marcus",
    "channel": "slack:@marcus"
  },
  "actions": [
    {
      "id": "send_slack",
      "label": "Send via Slack",
      "kind": "slack_send"
    }
  ]
}
```

### High-stakes reply (relationship too sensitive to ghost-write) *(teaches: when the relationship history is thin, surface the matter and let the principal write — explain why in rationale)*

```json
{
  "date": "2026-05-11",
  "id": "reply-board-member-question-2026-05-11",
  "section": "on_the_desk",
  "headline": "Reply to Patricia re: Q2 hiring plan",
  "rationale": "Board member; relationship is 4 months old. The question is substantive and I don't have enough of your observed voice in board-member threads to draft safely. Better in your own words.",
  "anchor_refs": [
    "patricia_osei"
  ],
  "content": {
    "prompt": "Patricia asked for your thinking on the Q2 engineering hiring plan before Thursday's board call. She wants 2–3 sentences, not a doc. Keep it confident; she responds well to directness.",
    "placeholder": "2-3 sentences, confident",
    "to": "Patricia",
    "channel": "email"
  },
  "actions": [
    {
      "id": "send",
      "label": "Send",
      "kind": "email_send_inline"
    }
  ]
}
```

