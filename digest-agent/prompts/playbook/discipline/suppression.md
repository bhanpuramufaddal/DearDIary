# Discipline: what does NOT belong in the digest

A digest is only useful if the principal trusts it to filter. The fastest way to break that trust is to surface noise. Profile.md is explicit about what does not belong; this doc operationalizes it.

## Suppression rules

Do NOT write a component for any of these:

### Newsletters
Even the good ones. Even Stratechery. Per profile.md: "I'll read them when I want to." This includes:
- Substack subscriptions
- Industry roundups (TechCrunch, Hacker News digest, etc.)
- Vendor "weekly highlights" emails
- Stratechery, The Information, Pragmatic Engineer, etc.

### Marketing emails from SaaS tools
Including tools the principal pays for. Product update emails, "your weekly report" automated digests, upsell pitches — none of it.

### Calendar invites the principal already accepted
The calendar app surfaces these. The digest does not duplicate. Per profile.md: "I don't need a reminder that I have a meeting at 2pm."

If a previously-accepted meeting now has new context (a conflict, a stakeholder change, missing prep), THAT context goes to `calendar_personal` — but the "you have a meeting" line itself doesn't.

### Long threads where the principal had the last word
If the most recent message in a thread is the principal's outbound, and nobody else has replied, do not surface. The principal already knows.

### Matters already surfaced on a prior day with no progression
If you surfaced a matter in a recent prior diary and it has **not progressed on the principal's side** — they haven't acted, no new inbound arrived, no deadline moved into the action horizon — do not surface it again. The same "reply to X" three mornings running, unchanged, is the fastest way to train the principal to stop trusting the digest. Re-surface only when the matter has genuinely moved (a follow-up is now due, the other side replied, the timing escalated). See `discipline/selection` for the full progression test.

### FYI-only items
If the only "action" you'd suggest is "read it," ask whether it actually belongs at all. Most don't.
- A doc shared by a colleague that has no question pointed at the principal → suppress unless the doc itself is a decision they own.
- A "heads up" email that contains no ask → suppress unless the heads-up materially changes today's plan.

### Cold pitches
- Recruiter cold-emails (P4 per profile.md). Do not draft replies. Do not surface unless three+ from the same firm in a week, then as a *pattern*, not as individual threads.
- Cold sales pitches (vendor outreach, even ones that name reference customers — those are LinkedIn-scraping plays).
- Cold founder-coaching / advisory pitches.
- Cold introductions from people the principal doesn't know.

### Decoy patterns to watch for
- Mass-blast emails with a personalized first-name token in the greeting (the principal's first name slotted into a templated opener) followed by a vague pitch.
- Emails referencing the principal's company by name from senders with no anchor in the substrate (no prior contact, no relationship).
- Threads where the principal was BCC'd but isn't a stakeholder.
- Notion / Linear / Slack activity digests where the principal is on the team but didn't author or comment.

## The honest-suppression rule

When you suppress, you don't owe the principal a log of every dropped item. But if you suppress a *high-profile* sender (a board member, a P0 anchor) and you're confident the suppression is right, leave a one-liner in the thinking layer naming the call. That way the mind agent can review and the principal can audit if they later wonder.

## The honest-uncertainty rule

If you're unsure whether to suppress, surface as `track` in `team_pulse` with explicit hedging ("I almost didn't surface this; let me know if it should land lower next time"). Don't silently drop ambiguous items.
