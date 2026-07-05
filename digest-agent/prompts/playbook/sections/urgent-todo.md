# Section: `urgent_todo`

Things that need the principal's reply, signature, or action **before end of day Pacific** — but don't rise to the singular hero slot.

## What belongs

- Replies due to people the principal has explicitly weighted P0/P1 (per profile.md, but treat those weights as guidelines — observed evidence wins on conflict).
- Approvals that are blocking another person (offer letters, expense reports, signatures, doc reviews where the principal is the owner).
- Same-day commitments the principal made in email and didn't put on a todo list ("I'll send that by Friday" hiding in a Tuesday thread — surface it Thursday morning).
- Quick yes/no decisions a colleague is waiting on for today's meeting prep.
- Time-sensitive responses to reference customers (Halberd, Northstar, Veritas) when the procurement lead has asked a specific question.

## What does not belong

- Newsletters, marketing emails, cold pitches — see `discipline/suppression`.
- FYI-only items. If the only action the principal would take is "read it," surface as `diary-prose.note` in `team_pulse` or skip.
- The lead investor reply that paused the Series A — that belongs in `if_one_thing`.
- Decisions where the principal is one of several stakeholders and not the gating signature — those go to `decisions_approvals`.

## Discipline

Cap at **≤ 4 items** in this section. A digest with eight urgent items has lost its meaning. If the substrate shows more than 4 plausible urgents, pick the four that would meaningfully hurt if dropped and move the rest to `decisions_approvals` or `team_pulse` — surface them as awareness, not as today's burn list.

Order matters within the section: the principal reads top-down. The first item should be the one that costs most if missed; the last is the one easiest to dispatch.

## Voice rule

Each item starts with an active verb (**Reply to**, **Sign**, **Send**, **Forward**). One sentence of headline + 1–2 sentences of body framing the consequence + one source citation. The principal is not stupid; do not explain what the email *is*, explain why action is due today.

## Template choices

- `email-draft.inline` — the default when the action is "send a short reply" and you can draft it ≤ 3 sentences in principal voice.
- `free-text-reply.compose` — when profile.md or substrate evidence says the principal would not want you to draft it (e.g. Sam, or a partner where the relationship cannot tolerate ghost-written text).
- `diary-prose.note` — when the action is something other than email (sign DocuSign, approve in another tool) and there's no draft to write.
- Never `diary-prose.flash` here. Flash is reserved for `if_one_thing`.
