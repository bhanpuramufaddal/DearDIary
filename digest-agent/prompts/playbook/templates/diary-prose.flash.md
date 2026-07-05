<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/diary-prose.flash.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `diary-prose.flash` (`type: diary-prose`)

MCP tool: `write_diary_prose_flash`

Urgent paraphrased prose — the "you should see this right now" surface. At most 1–2 per day.

**Voice.** Direct, declarative, no buildup. The first sentence carries the whole signal. The body is what to attend to — not what to do (HITL templates own "what to do"). If you are tempted to use flash for something that is not, in fact, urgent — write a diary-prose.note instead.

**`action.kind` values:** `dismiss`

**Content fields:**

- `text`: `string` (20–800 chars) — Urgent paraphrased prose in your voice. Lead with the one-line that lands in two seconds ("Marcus said no", "Investor wants to talk before noon"). Then 1–3 sentences of what they need to know and, if applicable, what to attend to right now. Tight.

## Example calls

### Bad news (deal outcome) *(teaches: lead with the one-line that lands in two seconds; body is context, not action steps)*

```json
{
  "date": "2026-05-04",
  "id": "flash-marcus-no-2026-05-04",
  "section": "right_now",
  "headline": "Marcus said no",
  "anchor_refs": [
    "marcus_webb"
  ],
  "content": {
    "text": "Marcus replied at 11:47pm: he is passing on the Series A. He cited the option-pool refresh question you walked through Friday — said the post-refresh dilution math no longer works for his existing common. He framed it as final but warm. Two other term sheets are still live; Maya will know first."
  },
  "actions": [
    {
      "id": "dismiss",
      "label": "Got it",
      "kind": "dismiss"
    }
  ]
}
```

### Urgent positive (time window) *(teaches: flash is also right for urgent-good news with a narrow window, not just bad news)*

```json
{
  "date": "2026-05-07",
  "id": "flash-term-sheet-2026-05-07",
  "section": "right_now",
  "headline": "Inflection Point's term sheet is in your inbox",
  "anchor_refs": [
    "inflection_point_ventures"
  ],
  "content": {
    "text": "The term sheet landed at 6:04am. Marcus says the partner meeting is Thursday and they'd like a verbal yes before noon today to hold the slot. Two other firms are still in process."
  },
  "actions": [
    {
      "id": "dismiss",
      "label": "Got it",
      "kind": "dismiss"
    }
  ]
}
```

### Conflict alert (calendar) *(teaches: flash when a conflict has a real consequence today — not just 'you have two meetings')*

```json
{
  "date": "2026-05-08",
  "id": "flash-wren-doctor-clash-2026-05-08",
  "section": "right_now",
  "headline": "Wren's 3pm doctor appointment clashes with the Series A closing call",
  "anchor_refs": [],
  "content": {
    "text": "Sam added Wren's pediatrician at 3pm today. Your closing call with counsel is also 3–4pm — you can't move the closing call. Sam doesn't know yet."
  },
  "actions": [
    {
      "id": "dismiss",
      "label": "Got it",
      "kind": "dismiss"
    }
  ]
}
```

