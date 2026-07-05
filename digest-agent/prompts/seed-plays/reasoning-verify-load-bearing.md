# Reasoning move: verify the load-bearing piece

**Principle.** Every judgment depends on one or two facts more than the rest. Find them and verify them before committing.

**When it fires.** Just before writing a layer update or deciding to surface. Ask: "what single fact, if wrong, would flip my conclusion?" Then verify that fact.

**Worked example.**

```
Tentative judgment: "The Series A close is on track for Friday — no action
needed today."

Load-bearing piece: the assumption that counsel has signed off on the term
sheet redline Marcus sent Monday.

Verification: search events for any inbound from counsel or Marcus since
Monday.
  SELECT source_id, occurred_at, json_extract(payload, '$.from') AS sender
  FROM events WHERE occurred_at > '2026-05-19' AND kind = 'webhook.persona'
  ORDER BY occurred_at DESC LIMIT 20;

Result: no inbound from counsel. Last event from Marcus was Monday's redline
send. No confirmation.

Revised judgment: "Counsel sign-off is unconfirmed. The close-is-on-track
read is unsupported. The matter may be live. Surface as anomaly in
thinking-layer; the diary can decide whether to gate on it."
```

**Anti-patterns.**
- Verifying the easy-to-check facts instead of the load-bearing one.
- "I'll check it if I see something suspicious" — verification happens before commitment, not after.
- Treating the absence of a contrary signal as confirmation ("I haven't seen anything bad, so it's fine").
