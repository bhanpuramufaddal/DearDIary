<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/choose-one.cards.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `choose-one.cards` (`type: choose-one`)

MCP tool: `write_choose_one_cards`

Forced multi-option pick (2–5 mutually exclusive cards).

**Voice.** The prompt frames the choice concretely ("Which gets your hours this week?"). Option labels stay tight; detail lines explain why each is worth considering, in neutral terms.

**`action.kind` values:** `confirm_option`

**Content fields:**

- `prompt`: `string` (10–400 chars) — The question the principal is answering. 1–2 sentences.
- `options`: `object[]` — Between 2 and 5 options. Mutually exclusive.
  - `id`: `string` (1–64 chars) — Stable option id, kebab-case. Carried in principal_input.option_id.
  - `label`: `string` (1–120 chars) — Short label shown on the card (e.g. "Keep Tuesday standup").
  - `detail`: `string` (≤400 chars) *(optional)* — Optional second line under the label — 1–2 sentences max.

## Example calls

### Weekly priority pick *(teaches: prompt forces the tradeoff; detail lines name the cost of not picking this option)*

```json
{
  "date": "2026-05-03",
  "id": "pick-week-priority-2026-05-03",
  "section": "right_now",
  "headline": "One priority for this week",
  "rationale": "You can't do all three well. Pick the one that gets your attention; the others slip honestly.",
  "anchor_refs": [],
  "content": {
    "prompt": "Three things compete this week. Which gets your hours?",
    "options": [
      {
        "id": "series_a_close",
        "label": "Close the Series A",
        "detail": "Term sheet signed; counsel review due Friday. Marcus expects a final call by Wednesday."
      },
      {
        "id": "case_studies_q2",
        "label": "Q2 case studies",
        "detail": "Renee's first week — kickoff Monday, three drafts targeted for 5/15."
      },
      {
        "id": "hire_engineering_lead",
        "label": "Hire the eng lead",
        "detail": "Final-round Wednesday with Sam; offer needs to land by Friday or they take the other one."
      }
    ]
  },
  "actions": [
    {
      "id": "confirm",
      "label": "Confirm pick",
      "kind": "confirm_option"
    }
  ]
}
```

### Binary hire decision *(teaches: two-option pick where both options are valid — agent stays neutral, no recommendation)*

```json
{
  "date": "2026-05-09",
  "id": "hire-offer-decide-2026-05-09",
  "section": "on_the_desk",
  "headline": "Engineering lead offer — extend or pass?",
  "rationale": "Panel feedback converged. Waiting on your call; offer letter is ready to send.",
  "anchor_refs": [
    "jordan_cole"
  ],
  "content": {
    "prompt": "Jordan's panel is done. Both outcomes are defensible — your call.",
    "options": [
      {
        "id": "extend",
        "label": "Extend offer",
        "detail": "Strong backend depth; culture fit was good. Offer letter is ready; start date can be June 2."
      },
      {
        "id": "pass",
        "label": "Pass",
        "detail": "Two interviewers flagged communication style in distributed work. Risk is real if the team stays remote."
      }
    ]
  },
  "actions": [
    {
      "id": "confirm",
      "label": "Confirm",
      "kind": "confirm_option"
    }
  ]
}
```

