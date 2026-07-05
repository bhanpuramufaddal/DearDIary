# How to derive a situation-handling play

This is a worked example of the derivation *move* — read it, then apply it to the principal's real history. A play is a reusable precedent ("when situation X recurs, here is how THIS principal handles it"), generalized from real artifacts and cited to their `source_id`s. The 20–30 days you just read ARE sufficient evidence: if you can name a recurring pattern, you can derive its play **now** — do not defer to "once the mind agent sees more examples."

**What you're looking for:** a situation that recurs, handled in a characteristic way.

**Raw signal (generic):** in sent mail you find three Friday-afternoon emails to the same investor distribution list. Each is ~6 lines — opens with the week's headline metric (no greeting), 2–3 terse update bullets, one ask, signed first-name only.

**The move:** recurrence (3×, same cadence + recipients) plus consistency (same shape every time) *is* the pattern. Generalize the shape, not one email's exact words:
- trigger — "the weekly investor update, ~Friday afternoon"
- characteristic handling — numbers-first, no greeting, 2–3 bullets, one ask, signs first-name-only
- evidence — the real `source_id`s of the 2–3 emails you generalized from

**The row you insert:**
```sql
INSERT INTO plays (name, title, content, derived_from, created_at)
VALUES ('investor-weekly-update',
        'How <principal> sends the weekly investor update',
        '<the generalized precedent prose, plus one short real excerpt for flavor>',
        '["<msgid1>","<msgid2>","<msgid3>"]', :now);
```

**Anti-patterns:** don't defer for "more examples" — three in 30 days is a strong pattern. Don't paste one email verbatim — a play is the generalized shape with a short excerpt, not a transcript.
