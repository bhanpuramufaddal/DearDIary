<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/big-number.metric.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `big-number.metric` (`type: big-number`)

MCP tool: `write_big_number_metric`

One hero metric (label + value + delta + optional sparkline) plus paraphrased context.

**Voice.** The number is the visual; context_summary is the prose. Lead context with what changed and what caused it, then say what the principal should make of it. Do not narrate the number itself — the renderer shows it.

**`action.kind` values:** `dismiss`

**Content fields:**

- `label`: `string` (1–80 chars) — What the number is. e.g. "ARR" or "Weekly active users".
- `value`: `string` (1–40 chars) — The number formatted for display. e.g. "$2.4M", "14,300", "92%".
- `delta`: `object` *(optional)* — How the number moved, if relevant. Omit for absolute snapshots.
  - `direction`: `"up" | "down" | "flat"`
  - `text`: `string` (1–60 chars) — Formatted delta string, e.g. "+14% vs last week" or "-$120K MoM".
- `sparkline`: `object[]` *(optional)* — Optional time series of recent points. Renderer shows it as a small inline sparkline beside the number.
  - `t`: `string` (date-time) — Point timestamp in ISO 8601 with offset.
  - `y`: `number` — Numeric value at this time.
- `context_summary`: `string` (40–1500 chars) — Paraphrased context in your voice. What moved, what caused it, what to make of it. Pull from history and related anchors, not just this datapoint.

## Example calls

### Milestone metric (meaningful threshold crossed) *(teaches: context_summary names WHY this number matters now — ties to a known commitment or model)*

```json
{
  "date": "2026-05-01",
  "id": "arr-crossed-2-4m-2026-05-01",
  "section": "right_now",
  "headline": "ARR crossed $2.4M",
  "rationale": "First time above the Series A pricing-model threshold.",
  "anchor_refs": [
    "acme_corp",
    "halberd"
  ],
  "content": {
    "label": "ARR",
    "value": "$2.4M",
    "delta": {
      "direction": "up",
      "text": "+$180K vs last week"
    },
    "sparkline": [
      {
        "t": "2026-04-01T00:00:00-07:00",
        "y": 2090000
      },
      {
        "t": "2026-04-08T00:00:00-07:00",
        "y": 2150000
      },
      {
        "t": "2026-04-15T00:00:00-07:00",
        "y": 2210000
      },
      {
        "t": "2026-04-22T00:00:00-07:00",
        "y": 2280000
      },
      {
        "t": "2026-04-29T00:00:00-07:00",
        "y": 2400000
      }
    ],
    "context_summary": "Acme renewed Tuesday for $96K and Halberd's expansion landed Friday at $84K — together they pushed you across $2.4M for the first time. The Series A model assumed $2.3M at term-sheet sign; you're 4 weeks ahead on net new alone. Marcus will see this on the cap-table call Wednesday."
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

### Softening metric (worth flagging, not alarming) *(teaches: context_summary names the cause and calibrates urgency — 'worth a look' vs 'alarm')*

```json
{
  "date": "2026-05-05",
  "id": "activation-softening-2026-05-05",
  "section": "tracking",
  "headline": "Day-7 activation softened this week",
  "anchor_refs": [],
  "content": {
    "label": "Day-7 activation",
    "value": "42%",
    "delta": {
      "direction": "down",
      "text": "-8 pts vs last week"
    },
    "context_summary": "The drop started the week the new onboarding test cohort went live. The control cohort is flat at 50%. It could be seasonality or cohort composition — but if the next cohort (Wednesday) repeats the pattern, the test is the prime suspect and worth pausing before rollout."
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

