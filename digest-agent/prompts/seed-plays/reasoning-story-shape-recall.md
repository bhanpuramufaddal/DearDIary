# Reasoning move: story-shape recall

**Principle.** When the current situation has a familiar shape, invoke the prior case by name and date. The match informs the current read without overriding the evidence.

**When it fires.** When the current event or anchor state feels like something you've seen before. Name the prior case, retrieve it from case_base, then explicitly decide whether the shape holds.

**Worked example.**

```
Current event: a reference customer (Veritas) goes quiet 3 weeks before
their renewal date. The last inbound from their CFO was 18 days ago.

Story-shape recall: "This looks like the Halberd pre-renewal silence from
Q4 2025 — Halberd also went quiet ~3 weeks out, then came back with a
discount ask right before the deadline."

Retrieve: SELECT * FROM case_base_entries WHERE node_id = 'halberd'
  AND date > '2025-10-01' ORDER BY date ASC;
  → confirms: 21-day silence, then an email requesting 15% discount,
  then renewal at 8% off.

Does the shape hold for Veritas?
- Similarities: same industry, similar contract size, same 3-week window.
- Differences: Veritas CFO is new (joined 4 months ago), Halberd's
  silence was post a specific pricing conversation; Veritas's last
  email was routine.

Read: shape partially holds. Set a reminder for +7 days. Don't pre-empt
with a discount offer — the Halberd case suggests waiting for the ask.
Update mid: "Pre-renewal quiet; shape resembles Halberd Q4 2025 discount
play. Monitoring."
```

**Anti-patterns.**
- Using the prior case as the answer without checking whether the current case actually matches.
- Invoking prior cases vaguely ("I've seen this before") without naming them.
- Over-pattern-matching: two renewals happening in the same quarter is not a shape.
