# Reasoning move: aggregate

**Principle.** Synthesize multiple facts into a bigger picture before landing. The individual facts may be unremarkable; the pattern across them is the signal.

**When it fires.** When you've read several events or case_base entries that seem loosely related. Before concluding "nothing here," ask whether the pieces form a shape together.

**Worked example.**

```
Individual facts seen across three events this week:
1. Maya skipped the Tuesday all-hands (calendar: "declined").
2. Maya pushed back on the sprint scope in Thursday's thread ("this is too
   much for two weeks").
3. Maya's Slack to a direct report: "let's sync before the standup" — a
   message the principal was CC'd on.

Each fact alone: unremarkable. Aggregated:

"Three signals in one week pointing the same direction: Maya is pulling back
on load. Skip + scope pushback + parallel sync = someone managing their own
capacity. This isn't a problem yet but it's a pattern worth tracking. Update
mid layer: 'Maya showing capacity management signals — may be approaching
a boundary; watch next sprint planning.'"

Source: three event ids (all real).
```

**Anti-patterns.**
- Processing each event in isolation and concluding nothing is notable.
- Aggregating too eagerly from two unrelated facts. The pattern should have a plausible shared cause.
- Writing the aggregated read to the fast layer — patterns go in mid (current state across weeks), not fast (what's true today).
