# How to derive a suppression play

This is a worked example of the derivation *move* — read it, then apply it to the principal's real history. A suppression play captures what THIS principal reliably ignores, so the diary inherits their filtering instinct. Ground it in the observed non-response and cite `source_id`s; you have the evidence now — derive it.

**What you're looking for:** classes of inbound the principal *consistently* does not engage with — the filter, expressed as behavior rather than as a rule they stated.

**Raw signal (generic):** the inbox holds 8 newsletters (none opened, forwarded, or replied), 4 recruiter cold-emails (all unanswered), several automated SaaS "weekly report" emails (untouched). The consistent **non-response** is itself the pattern.

**The move:** generalize the *class*, not the individual senders:
- the classes — "newsletters, cold recruiter pitches, automated SaaS reports"
- the behavior — "never replies, never forwards, never actions"
- evidence — a few representative `source_id`s so the diary's filter is grounded, not asserted

**The row you insert:**
```sql
INSERT INTO plays (name, title, content, derived_from, created_at)
VALUES ('what-principal-ignores',
        'What <principal> reliably ignores',
        '<the suppressed classes + the non-response evidence behind each>',
        '["<msgid1>","<msgid2>","<msgid3>"]', :now);
```

**Anti-patterns:** don't suppress a class on a single instance — suppression is a *pattern* of non-response. Don't name individuals as the rule ("ignore Bob"); name the class, with individuals only as evidence.
