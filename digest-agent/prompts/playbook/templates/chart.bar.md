<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/chart.bar.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `chart.bar` (`type: chart`)

MCP tool: `write_chart_bar`

Categorical bar chart with a paraphrased context paragraph naming the story.

**Voice.** The chart shows the comparison; the summary names what it reveals ("three deals dominate the pipeline by size"). Do not enumerate bars in the prose.

**`action.kind` values:** `dismiss`

**Content fields:**

- `context_summary`: `string` (40–1500 chars) — Paraphrased context in your voice naming what the comparison reveals ("customer support tickets cluster on one team"). Do not list bar values — the renderer shows them.
- `y_axis_label`: `string` (1–80 chars) — What the bar height measures.
- `bars`: `object[]` — Between 2 and 20 categorical bars. Order matters — render in array order.
  - `label`: `string` (1–80 chars) — Category label shown on the axis.
  - `value`: `number` — Bar height for this category.

## Example calls

### Pipeline concentration (the point is risk) *(teaches: context_summary draws the implication — not just what the chart shows, but what it means for action)*

```json
{
  "date": "2026-05-04",
  "id": "pipeline-top-deals-2026-05-04",
  "section": "tracking",
  "headline": "Pipeline weight is concentrated in three deals",
  "rationale": "Top of pipe by expected ARR.",
  "anchor_refs": [
    "acme_corp",
    "halberd",
    "bench_accounting"
  ],
  "content": {
    "context_summary": "The top three deals account for roughly 70% of the current pipeline by expected ARR — Acme expansion, Halberd net new, Bench expansion. If any one of them slips beyond Q2, the quarterly model drops below the Series A pricing threshold. The rest of the pipeline is healthy but unconcentrated; treat the top three as the sensitive set.",
    "y_axis_label": "Expected ARR ($K)",
    "bars": [
      {
        "label": "Acme",
        "value": 320
      },
      {
        "label": "Halberd",
        "value": 240
      },
      {
        "label": "Bench",
        "value": 180
      },
      {
        "label": "Holdfast",
        "value": 90
      },
      {
        "label": "Gabe Corp",
        "value": 60
      },
      {
        "label": "Other",
        "value": 70
      }
    ]
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

### Support ticket distribution (the point is skew) *(teaches: context_summary names the skew and what to do about it — not a description of which bar is tallest)*

```json
{
  "date": "2026-05-07",
  "id": "support-by-customer-2026-05-07",
  "section": "tracking",
  "headline": "Support tickets are clustering on Halberd",
  "anchor_refs": [
    "halberd"
  ],
  "content": {
    "context_summary": "Halberd accounts for 40% of open support tickets this week despite being one of six active accounts. The spike started Monday after their migration. Worth a direct outreach before it becomes a renewal signal — their CFO renewal meeting is in 3 weeks.",
    "y_axis_label": "Open tickets",
    "bars": [
      {
        "label": "Halberd",
        "value": 19
      },
      {
        "label": "Acme",
        "value": 8
      },
      {
        "label": "Bench",
        "value": 6
      },
      {
        "label": "Holdfast",
        "value": 5
      },
      {
        "label": "Other",
        "value": 9
      }
    ]
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

