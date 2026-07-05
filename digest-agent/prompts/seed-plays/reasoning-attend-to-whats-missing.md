# Reasoning move: attend to what's missing

**Principle.** The absence of an expected signal is evidence. A dog that doesn't bark is data. Model what *should* have arrived and didn't.

**When it fires.** After reading the inbox or substrate for a high-stakes anchor — especially when you're about to conclude "nothing new, no update needed." Pause: what *should* have arrived by now?

**Worked example.**

```
Anchor: marcus_webb, lead investor, mid layer says "awaiting cap table
comments — sent Tuesday."

Today is Friday. The inbox has no reply from Marcus.

Without this move: "No new events from Marcus — no update."

With this move:
- Prediction: "Marcus replies within 24h" (precision 0.82)
- Expected: reply by Wednesday EOD at the latest
- Observed: silence for 3 days

The absence is the event. The fast layer should note the silence:
  update_anchor_layer({
    id: 'marcus_webb', layer: 'fast',
    content: 'No reply to cap-table send (Tue) — 3-day silence anomalous
              given 0.82-precision 24h pattern. Could be travel, could be
              a problem. Ball is in his court but worth surfacing.',
    source_ids: ['<the Tuesday outbound email id>'],
  })
  contradict_prediction_precision({ id: '<pred_id>' })
```

**Anti-patterns.**
- Only processing events that *arrived* — the full picture includes what didn't arrive.
- Noting silence only for P0 anchors; the move applies to any anchor with a calibrated timing prediction.
- Citing the outbound message as evidence of the reply (the source_id for "he hasn't replied" is the *sent* message, not a received one).
