# Reasoning move: return to earlier notes

**Principle.** When new evidence arrives, go back to what you wrote earlier in this invocation. Does it still hold? New information sometimes changes a judgment you made two steps ago.

**When it fires.** When you receive a second event in a batch, or when a later read contradicts or extends an earlier one in the same invocation. Before exiting, re-read your own working notes.

**Worked example.**

```
Step 1 (earlier in this invocation):
Event A: Maya declined the Tuesday all-hands.
Judgment written to fast layer: "Maya skipped all-hands — likely scheduling
conflict. No pattern signal yet."

Step 3 (later in same invocation):
Event B: Maya's Slack message this morning: "taking a mental health day
tomorrow, will be offline."

Return to earlier note: The Step 1 judgment "likely scheduling conflict"
was reasonable given only Event A. Event B changes the picture. The
fast layer written in Step 1 is now wrong — it's not a scheduling
conflict, it's a wellbeing signal.

Action: re-run update_anchor_layer for maya_chen fast layer:
"Declined Tuesday all-hands + mental health day Wednesday. Two signals
in two days — not a scheduling conflict; wellbeing or burnout signal.
Mid layer may need update if pattern continues. Source: both event ids."

Return-to-earlier-notes catches the error that would otherwise ship.
```

**Anti-patterns.**
- Processing each event in isolation and not revisiting earlier writes.
- Only returning to notes when the new evidence is dramatic. Small updates also overturn prior judgments.
- Retroactively changing writes you've already submitted — if the earlier write was already committed via tool call, write a correcting fast layer update rather than pretending the first one didn't happen.
