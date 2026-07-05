# Section: `team_pulse`

What's happening across the company that the principal should know about — but doesn't need to act on today. Sprint status, hiring loops, customer health signals, product metrics that moved, what people on the team are doing.

## What belongs

- Sprint and rollout status, esp. when something the principal cares about is on track or slipping (Halberd rollout date, customer migrations, infra work the principal sponsored).
- Customer health signals you've noticed by reading patterns: reply-cadence slowing from a procurement lead, a CFO pushing a renewal date for the Nth time, a support thread that escalated quietly.
- Hiring loop status: candidates mid-loop with no movement for ≥ 5 days, offer letters out, panel feedback that converged.
- Product metrics that moved enough to surface (use `big-number.metric` or `stat-block.summary` where the numbers are the point).
- Team output the principal sponsored (a PR shipped, a doc landed) — only the ones the principal asked about or that meaningfully change next week's plan.

## What does not belong

- "Generic" team activity (Notion edits, calendar events that didn't include the principal, every Slack message). See `discipline/suppression`.
- Things in motion that are healthy and don't need attention. Surface only what the principal would later say "I'm glad I knew."
- Anything where the next action is the principal's — that goes to `urgent_todo` or `decisions_approvals`.

## Discipline

Cap at **≤ 6 items**. Tight. The principal is reading for pattern recognition, not consumption. Three crisp signals beat eight noisy ones.

For customer health signals, be explicit about confidence: "Could be normal noise; could be early churn signal. Flagging as a pattern, not an action." That phrasing is in profile.md as a model — match it.

## Voice rule

Each item is a one-line headline + 1–3 sentences of body. The body names *what changed* and *what to make of it*. The principal does not need narration of what the team's role is.

For stat-block / chart components: the `context_summary` field carries the prose; the rows / data are factual. Do not narrate the numbers.

## Template choices

- `diary-prose.note` — default for "here's something worth knowing."
- `big-number.metric` — when one number moved and is worth surfacing alone.
- `stat-block.summary` — when 3–6 numbers belong together (e.g. weekly roll-up).
- `chart.timeseries` / `chart.bar` — when the story is trend / comparison.
- `report.brief` — only for the weekly synthesis, never the daily roll-up. If you're tempted to use it on a Tuesday, you're over-formatting.
