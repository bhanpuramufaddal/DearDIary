<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/chart.timeseries.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `chart.timeseries` (`type: chart`)

MCP tool: `write_chart_timeseries`

Line/area chart over time with a paraphrased context paragraph naming the trend.

**Voice.** The chart shows the shape; the context_summary names the story. Lead the summary with the trend the principal should notice; do not list datapoints.

**`action.kind` values:** `dismiss`

**Content fields:**

- `context_summary`: `string` (40–1500 chars) — Paraphrased context in your voice. Name the trend the chart tells ("activation has softened three weeks in a row"). Do not narrate axes — the renderer shows them.
- `y_axis_label`: `string` (1–80 chars) — What the y-axis measures.
- `x_axis_label`: `string` (1–80 chars) *(optional)* — Optional x-axis label. Renderer defaults to dates if omitted.
- `series`: `object[]` — Between 1 and 4 series. Order from most to least important.
  - `name`: `string` (1–80 chars) — Series label shown in the legend.
  - `points`: `object[]`
    - `t`: `string` (date-time) — X-axis timestamp, ISO 8601 with offset.
    - `y`: `number` — Numeric value at this time.

## Example calls

### Diverging series (test vs control) *(teaches: context_summary names the divergence and what to do about it — not a description of the axes)*

```json
{
  "date": "2026-05-04",
  "id": "activation-trend-2026-05-04",
  "section": "on_the_desk",
  "headline": "Activation softening, three weeks running",
  "rationale": "The onboarding-test cohort underperforms; trend deserves a look.",
  "anchor_refs": [],
  "content": {
    "context_summary": "Day-7 activation has softened three weeks in a row, from 50% to 42%. The fall started the week the new onboarding test cohort went live; the control cohort held flat near 50%. If the next cohort (Wed) repeats the pattern, the test is your prime suspect and you would want to pause it before rolling further.",
    "y_axis_label": "Day-7 activation",
    "x_axis_label": "Week ending",
    "series": [
      {
        "name": "Test cohort",
        "points": [
          {
            "t": "2026-04-12T00:00:00-07:00",
            "y": 50.1
          },
          {
            "t": "2026-04-19T00:00:00-07:00",
            "y": 48.4
          },
          {
            "t": "2026-04-26T00:00:00-07:00",
            "y": 45.2
          },
          {
            "t": "2026-05-03T00:00:00-07:00",
            "y": 42
          }
        ]
      },
      {
        "name": "Control",
        "points": [
          {
            "t": "2026-04-12T00:00:00-07:00",
            "y": 49.8
          },
          {
            "t": "2026-04-19T00:00:00-07:00",
            "y": 50.2
          },
          {
            "t": "2026-04-26T00:00:00-07:00",
            "y": 50
          },
          {
            "t": "2026-05-03T00:00:00-07:00",
            "y": 49.6
          }
        ]
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

### Single-series growth trend *(teaches: one series is fine when the story is about trajectory, not comparison)*

```json
{
  "date": "2026-05-06",
  "id": "arr-growth-trend-2026-05-06",
  "section": "tracking",
  "headline": "ARR growing steadily — 8 weeks",
  "anchor_refs": [],
  "content": {
    "context_summary": "ARR has grown consistently over 8 weeks — no single large spike, which is the healthy sign: it's net expansion from existing accounts, not lumpy new logos.",
    "y_axis_label": "ARR ($)",
    "x_axis_label": "Week ending",
    "series": [
      {
        "name": "ARR",
        "points": [
          {
            "t": "2026-03-08T00:00:00-07:00",
            "y": 1900000
          },
          {
            "t": "2026-03-15T00:00:00-07:00",
            "y": 1970000
          },
          {
            "t": "2026-03-22T00:00:00-07:00",
            "y": 2040000
          },
          {
            "t": "2026-03-29T00:00:00-07:00",
            "y": 2100000
          },
          {
            "t": "2026-04-05T00:00:00-07:00",
            "y": 2170000
          },
          {
            "t": "2026-04-12T00:00:00-07:00",
            "y": 2220000
          },
          {
            "t": "2026-04-19T00:00:00-07:00",
            "y": 2310000
          },
          {
            "t": "2026-04-26T00:00:00-07:00",
            "y": 2400000
          }
        ]
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

