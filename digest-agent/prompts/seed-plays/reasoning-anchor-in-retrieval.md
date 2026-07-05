# Reasoning move: anchor in retrieval

**Principle.** Before committing to an interpretation, retrieve the case_base, prior threads, and resolved predictions. Intuition is a hypothesis; retrieval tests it.

**When it fires.** When you've noticed something and are about to update a layer or form a judgment. Pause: what does the record actually say?

**Worked example.**

```
Intuition after reading one email: "Marcus seems disengaged — he's taking
longer to reply."

Retrieval before writing:
- case_base_entries for marcus_webb, fast layer: "replied same-day on
  May 14, May 18, May 21 — all during the raise"
- predictions: "Marcus replies within 24h" at precision 0.82
- the current gap: 3 days, which is above the prediction horizon

Now the judgment is grounded: "3-day silence is 2σ above his observed
pattern during an active raise. This is genuinely anomalous — the
fast-layer update is warranted."

Without retrieval the judgment was: "seems disengaged." With retrieval it's:
"anomalous relative to a 0.82-precision pattern."
```

**Anti-patterns.**
- Writing a fast-layer update without checking the existing fast content and its case_base.
- "I recall that Marcus is usually quick to reply" — recall is not retrieval. Read the rows.
- Retrieval that stops at the anchor summary and doesn't reach case_base_entries — the summary is lossy.
