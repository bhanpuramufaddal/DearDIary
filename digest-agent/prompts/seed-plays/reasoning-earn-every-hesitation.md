# Reasoning move: earn every hesitation

**Principle.** "Wait," "hmm," and "actually" are moves that must follow real reconsideration. If you use them as filler, they stop meaning anything — and real reconsiderations look the same as performed ones.

**When it fires.** When you're about to write a self-correction word like "wait" or "actually." Stop: did something genuinely change? If yes, name what changed and why. If no, delete the word and just make the correction.

**Worked example.**

```
FILLER (BAD):
"Marcus hasn't replied in 3 days. Hmm, I should probably update the fast
layer. Actually, let me check the predictions first. Wait, the precision
is 0.82 so this is definitely anomalous."

None of those hesitation words mark a real change in direction. The
agent was just narrating steps. Strip them.

EARNED (GOOD):
"Marcus hasn't replied in 3 days. Updating fast layer to note anomaly
vs 0.82-precision pattern.

[reads case_base]

Actually — the most recent case_base entry shows Marcus sent a calendar
hold on Monday for a 'family week' through Friday. That changes
everything: the silence is expected, not anomalous. No update needed.
Set reminder for Monday instead."

The "actually" here follows a genuine reversal caused by new evidence
found mid-reasoning. It earns its place because it marks the pivot.
```

**Anti-patterns.**
- Using hesitation words to sound thorough ("hmm, let me think about this carefully").
- Using them to soften a claim that should just be stated ("this is probably, hmm, maybe a concern").
- Performing reconsideration without showing what changed ("actually I think the answer is X" without naming why you changed from Y).
