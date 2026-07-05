<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/calendar-block.decision.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `calendar-block.decision` (`type: calendar-block`)

MCP tool: `write_calendar_block_decision`

Inbound calendar invite needing accept/decline/propose decision.

**Voice.** The summary carries the decision context — what this meeting is for and what hinges on the principal's answer. Metadata (time, attendees, location) renders separately.

**`action.kind` values:** `accept`, `decline`, `propose`

**Content fields:**

- `when_iso`: `string` (date-time) — Event start time, ISO 8601 with offset (e.g. 2026-05-02T15:00:00-07:00).
- `when_label`: `string` (1–100 chars) *(optional)* — Optional human-readable label ('Sat May 2, 3pm PT'). The renderer formats from when_iso if omitted.
- `duration_min`: `integer` (≤1440) — Event duration in minutes.
- `with`: `string[]` *(optional)* — Attendees as display names or addresses. Omit for solo events.
- `location`: `string` (≤300 chars) *(optional)* — Physical address, room name, or video link.
- `summary`: `string` (20–600 chars) — 2–3 sentences in principal voice. What the meeting is for and what the decision hinges on.

## Example calls

### Non-trivial invite (new relationship) *(teaches: summary explains what the meeting is FOR, not just who and when; rationale names the stakes)*

```json
{
  "date": "2026-05-02",
  "id": "calendar-renee-strategy-2026-05-02",
  "section": "on_the_desk",
  "headline": "Renee Tan: strategy sit-down",
  "rationale": "First face-time with Renee on Q2 case studies. 30 min sets the tone for the next 6 weeks of work.",
  "anchor_refs": [
    "renee_tan"
  ],
  "content": {
    "when_iso": "2026-05-04T15:00:00-07:00",
    "when_label": "Mon May 4, 3pm PT",
    "duration_min": 30,
    "with": [
      "Renee Tan",
      "Maya Chen"
    ],
    "location": "https://meet.example/holdfast-strategy",
    "summary": "First sit-down since Renee joined. Wants strategic input on the case-studies arc before drafting begins. Maya will be on too."
  },
  "actions": [
    {
      "id": "accept",
      "label": "Accept",
      "kind": "accept"
    },
    {
      "id": "decline",
      "label": "Decline",
      "kind": "decline"
    },
    {
      "id": "propose",
      "label": "Propose another time",
      "kind": "propose"
    }
  ]
}
```

### Conflicted invite (propose) *(teaches: when the invite conflicts with something existing, the summary names the conflict so the principal can decide)*

```json
{
  "date": "2026-05-10",
  "id": "calendar-board-pre-read-conflict-2026-05-10",
  "section": "on_the_desk",
  "headline": "Board pre-read conflicts with the Series A closing call",
  "rationale": "Board pre-read is mandatory but the closing call can't move. Propose a 30-min shift.",
  "anchor_refs": [],
  "content": {
    "when_iso": "2026-05-12T14:00:00-07:00",
    "when_label": "Tue May 12, 2pm PT",
    "duration_min": 60,
    "with": [
      "Board members",
      "Maya Chen"
    ],
    "summary": "The pre-read overlaps your 2–3pm closing call with counsel. You can accept if you move the pre-read to 1pm or 3:30pm — both are clear on your calendar."
  },
  "actions": [
    {
      "id": "accept",
      "label": "Accept as-is",
      "kind": "accept"
    },
    {
      "id": "propose",
      "label": "Propose 1pm or 3:30pm",
      "kind": "propose"
    },
    {
      "id": "decline",
      "label": "Decline",
      "kind": "decline"
    }
  ]
}
```

