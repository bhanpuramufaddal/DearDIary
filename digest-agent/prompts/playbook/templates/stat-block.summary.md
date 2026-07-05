<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/stat-block.summary.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `stat-block.summary` (`type: stat-block`)

MCP tool: `write_stat_block_summary`

3–6 metric rows with a paraphrased context paragraph naming the cluster story.

**Voice.** The summary names the overall story ("a strong revenue week with two soft spots"). Rows are factual: label, value, delta. The agent does not narrate inside rows.

**`action.kind` values:** `dismiss`

**Content fields:**

- `context_summary`: `string` (40–1500 chars) — Paraphrased context in your voice naming what the cluster of numbers means together. Not a per-row narration — the rows speak for themselves; the summary frames the story.
- `rows`: `object[]` — Between 3 and 6 stat rows. Order from most to least important.
  - `label`: `string` (1–80 chars) — What this row measures.
  - `value`: `string` (1–40 chars) — The number, formatted for display.
  - `delta`: `object` *(optional)* — How the number moved, if relevant.
    - `direction`: `"up" | "down" | "flat"`
    - `text`: `string` (1–60 chars)

## Example calls

### Weekly roll-up (mixed signals) *(teaches: context_summary names the cluster story before listing rows; highlights the anomaly without over-alarming)*

```json
{
  "date": "2026-05-04",
  "id": "weekly-rollup-2026-05-04",
  "section": "on_the_desk",
  "headline": "Last week, at a glance",
  "rationale": "Roll-up of the metrics you watch on Monday mornings.",
  "anchor_refs": [],
  "content": {
    "context_summary": "Revenue had its best week of the quarter on the back of the Acme renewal and Halberd's expansion. Activation softened — the new onboarding test cohort underperforms last week's control by 8 points and is worth a look before the next cohort goes live Wednesday. Support load is flat; engineering shipped on plan.",
    "rows": [
      {
        "label": "New ARR",
        "value": "$180K",
        "delta": {
          "direction": "up",
          "text": "+$120K vs prior wk"
        }
      },
      {
        "label": "Activation (day-7)",
        "value": "42%",
        "delta": {
          "direction": "down",
          "text": "-8 pts vs prior wk"
        }
      },
      {
        "label": "Support tickets",
        "value": "47",
        "delta": {
          "direction": "flat",
          "text": "flat vs prior wk"
        }
      },
      {
        "label": "PRs shipped",
        "value": "23",
        "delta": {
          "direction": "up",
          "text": "+3 vs prior wk"
        }
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

### Hiring loop snapshot *(teaches: stat-block for qualitative/count metrics with no delta needed; context names what to do with the pattern)*

```json
{
  "date": "2026-05-06",
  "id": "hiring-loop-snapshot-2026-05-06",
  "section": "tracking",
  "headline": "Hiring loop — current state",
  "anchor_refs": [],
  "content": {
    "context_summary": "Three roles in active process. Eng lead is the most time-sensitive — offer window closes Friday. Design is stalled at panel stage; no feedback from two of the three interviewers after 5 days. Head of Sales is moving on plan.",
    "rows": [
      {
        "label": "Eng lead",
        "value": "Offer ready",
        "delta": {
          "direction": "flat",
          "text": "window closes Fri"
        }
      },
      {
        "label": "Product designer",
        "value": "Panel pending",
        "delta": {
          "direction": "down",
          "text": "2 panelists overdue"
        }
      },
      {
        "label": "Head of Sales",
        "value": "Final round",
        "delta": {
          "direction": "up",
          "text": "on track"
        }
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

