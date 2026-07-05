<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/report.brief.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `report.brief` (`type: report`)

MCP tool: `write_report_brief`

Short structured report — 2–6 blocks of prose interleaved with up to 2 inline charts. The narrative carries the argument; the charts illustrate.

**Voice.** Memo voice. Each prose block carries one move; the sequence is the argument. Open with what the report is and what it concludes; close with what the principal should notice or do. Charts are illustration — name the move in the surrounding prose, do not narrate the axes.

**`action.kind` values:** `dismiss`

**Content fields:**

- `blocks`: `unknown[]` — Ordered blocks (prose or chart). 2–6 total; at most 2 chart blocks. Renderer paints in array order — design the sequence: frame → evidence (maybe with a chart) → takeaway.

## Example calls

### Weekly business brief (prose + chart) *(teaches: open with the headline conclusion; use one chart inline; close with the one thing to watch)*

```json
{
  "date": "2026-05-04",
  "id": "weekly-business-brief-2026-05-04",
  "section": "on_the_desk",
  "headline": "Weekly business brief",
  "rationale": "Synthesis for the Monday roll-up.",
  "anchor_refs": [],
  "content": {
    "blocks": [
      {
        "kind": "prose",
        "text": "Last week was the strongest revenue week of the quarter — Acme's renewal and Halberd's expansion together added $180K of new ARR, pulling you above the $2.4M line for the first time. Underneath the revenue, activation softened: the new onboarding test cohort underperforms control by 8 points and has done so three weeks running."
      },
      {
        "kind": "timeseries",
        "caption": "Day-7 activation, last 4 weeks",
        "y_axis_label": "Day-7 activation (%)",
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
      {
        "kind": "prose",
        "text": "Takeaway: a strong revenue week riding on two named accounts, one product signal worth investigating before Wednesday, and a Series A decision that will set the next two weeks of priorities."
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

### Prose-only brief (no chart needed) *(teaches: report.brief works with prose blocks only — don't force a chart when the story is qualitative)*

```json
{
  "date": "2026-05-09",
  "id": "hiring-brief-2026-05-09",
  "section": "on_the_desk",
  "headline": "Hiring — where things stand",
  "anchor_refs": [],
  "content": {
    "blocks": [
      {
        "kind": "prose",
        "text": "Three roles are in process. The engineering lead offer is ready and needs to go out this week — Jordan's competing offer closes Friday. The product designer panel is stalled; two interviewers haven't submitted feedback after 5 days, which is unusual and worth a nudge before the candidate loses interest."
      },
      {
        "kind": "prose",
        "text": "Head of Sales is on track — final round is Wednesday and the candidate is warm. If Jordan accepts, you'll have two new hires starting in June, which changes your Q3 onboarding load. If Jordan passes, the eng search restarts and the Q3 plan needs a rethink."
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

