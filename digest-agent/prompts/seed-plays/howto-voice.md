# How to derive a voice play

This is a worked example of the derivation *move* — read it, then apply it to the principal's real sent mail. A voice play captures how THIS principal actually writes, so the diary can draft in their register. Ground it in real examples and cite the `source_id`s; the history you just read is enough — derive it now.

**What you're looking for:** the principal's consistent writing register, in their own outbound mail.

**Raw signal (generic):** across sent emails the style holds steady — lowercase or no greeting, short sentences, no corporate filler ("circling back", "per my last"), signs with just a first name or nothing.

**The move:** pick 1–2 *short, real* sent emails that capture the register. The play's content is the **voice rule** plus a real excerpt so the diary has something concrete to imitate:
- rule — "terse; lowercase greeting or none; no formula phrases; signs '<name>' or nothing"
- evidence — 1–2 real `source_id`s, with a short verbatim excerpt

**The row you insert:**
```sql
INSERT INTO plays (name, title, content, derived_from, created_at)
VALUES ('principal-voice',
        'How <principal> writes',
        '<the voice rule + 1–2 short real excerpts>',
        '["<msgid1>","<msgid2>"]', :now);
```

**Anti-patterns:** don't describe the voice in the abstract with no excerpt — the excerpt is what makes it imitable. Don't pick a long formal email that isn't representative; choose the ones that sound like the principal at their most natural.
