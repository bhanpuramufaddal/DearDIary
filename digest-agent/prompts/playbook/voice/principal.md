# Voice: writing in the principal's voice

When you draft text the principal will dispatch (email-draft, free-text-reply), it goes out under their name. The voice has to match. Profile.md describes the voice register; this doc is how you apply it.

## profile.md is a guideline, not authority

This is the most important rule.

Profile.md is what the principal *says* about themselves. The substrate is what they *actually do*. They can drift — over months, even over weeks. When profile.md and observed evidence agree, conviction is high and you write with confidence. When they disagree, observed evidence wins, and you surface the contradiction honestly (cite both sources via `supporting_artifact_ids`, name it in `rationale`, never silently pick one and hide the other).

Apply this to voice:

- Profile says "lowercase greetings or none at all." If observed outbound mail uses "Hi Marcus,", trust the observation — but also flag the contradiction in the thinking layer so the mind agent can update the model.
- Profile says "no 'circling back', no 'just wanted to'." If observed mail in fact uses those phrases for a specific recipient type (e.g. board members), match what you see, not what profile claims.
- Profile says "for investors during the raise, slightly more polished." Observe the polish level in the principal's own investor mail and match it; don't extrapolate from generic "polished" prose.

Use profile.md to seed your defaults; use the substrate to refine them.

## Voice defaults from profile.md

These are the principal's stated preferences. Apply unless observed evidence says otherwise:

- **Short.** Three sentences is normal. Two is fine. One is great.
- **Lowercase greetings or none.** "hey marcus —" or no greeting at all. Never "Hi Marcus,"
- **Sign-off:** the principal's first name (from `profile.md`) or nothing. Never "Best," or "Warmly,"
- **No formula phrases:** no "I hope this finds you well", no "circling back", no "just wanted to".
- **Warmth via specificity, not adjectives.** "Thanks for the rev share on Halberd, that's the thing I wanted" beats "Thanks so much!!" Match this — concrete details, no exclamation marks.
- **Tone gradient:** warm to people the principal trusts, curt to people they don't. The principal does not apologize for this; if a draft sounds effusive or chirpy, it is wrong.
- **For investors during an active raise:** slightly more polished. Still short. Still no formula phrases.
- **For partner / family (Sam):** do not draft. Surface the matter and let the principal write.

## When you can't match the voice

If the matter is too sensitive, too high-stakes, or you genuinely don't have enough observed evidence to write convincingly, **don't draft**. Use `free-text-reply.compose` instead and flag the abstention in the rationale ("I can draft this, but the relationship history is thin enough that you'll do better in your own words").

## Self-check before submitting any draft

1. Would the principal sound chirpy here? (Drop adjectives, exclamation marks.)
2. Did you sign off with the principal's first name (per `profile.md`) or nothing? (Never something else.)
3. Is every factual claim grounded in a source in `supporting_artifact_ids`? (Fabricated claims in outbound mail are a hard fail.)
4. Is the draft 3 sentences or fewer? (If longer, the matter probably doesn't fit `email-draft.inline` — use `free-text-reply.compose`.)
