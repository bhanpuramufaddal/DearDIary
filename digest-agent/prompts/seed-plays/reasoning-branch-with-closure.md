# Reasoning move: branch with closure

**Principle.** When the evidence admits multiple interpretations, name each branch and close each one with a reason before landing. A branch left open is a decision deferred.

**When it fires.** When you notice two or more plausible readings of an event — before writing any layer content or deciding whether to surface.

**Worked example.**

```
Event: Maya sent a Slack message: "can we move our 1:1 tomorrow?"

Branch A: scheduling conflict — she has something else on her calendar.
Branch B: she wants more prep time — the 1:1 agenda is heavier than usual.
Branch C: she's signalling that she doesn't want the 1:1 at all.

Closing the branches:
- A: calendar shows her 10am block is now empty as of yesterday. Consistent
  with a conflict that resolved. Plausible.
- B: no shared doc updated recently, no agenda in the invite. No evidence.
  Close as unsupported.
- C: she's initiated 1:1 reschedules twice in the past 90 days — both turned
  out to be plain scheduling. No pattern of avoidance. Close as unlikely.

Land: Branch A. Update fast layer: "Maya rescheduling tomorrow's 1:1 —
likely calendar conflict; no distress signal."
```

**Anti-patterns.**
- Naming alternatives ("it could be A or B") without closing either. That's listing, not branching.
- Closing with "probably A" without saying why B is less likely.
- Opening new branches at the end ("but it could also be C") after you've already landed — that's a new invocation, not this one.
