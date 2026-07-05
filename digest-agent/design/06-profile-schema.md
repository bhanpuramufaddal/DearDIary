# Profile Schema — The Principal's Authored Seed

`profile.md` is the principal's prose self-description: who they are, who matters, what to suppress, voice, blind spots. It is the durable seed for the principal-anchor (see [01-anchor-model.md](01-anchor-model.md)).

Operational settings (timezone, schedule, event sources, MCP servers, models) live in `config.jsonc`, not here. See [10-config.md](10-config.md).

This doc specifies the fields, defaults, the principal-anchor relationship, the `--customize` override, and the Avery example.

## Role of profile.md

Lives at `~/digest/profile.md`. The principal owns it. **Not runtime config** — no UI, no API, no slash command writes to it. The principal edits the file directly.

The tool reads `profile.md` in two situations:

1. **At cold-start.** First run: the cold-start agent reads it end-to-end and seeds the principal-anchor at `~/digest/anchors/_principal.json`. It seeds nothing else. Other anchors enter the system later through mind-agent action — direct creation on high-conviction first sight, or promotion from an accumulating entity.
2. **On subsequent invocations** when mtime has changed. The mind agent re-seeds the principal-anchor's slow-layer seeded content while preserving observation-derived content where the two don't conflict.

Between mtime changes, `profile.md` is not re-read. The principal-anchor is the working surface; the profile is the seed.

## profile.md and the principal-anchor

The principal-anchor is the agent's structured model of the principal — one anchor among many, the richest one, the default prior for new entities. Same three-layer shape as every anchor. What makes it the principal-anchor: it is about the principal, and every agent invocation loads it.

`profile.md` is the principal's **declared** self-description. The principal-anchor is the agent's **observed-and-learned** model. They are not the same thing.

When they diverge — the principal wrote "ignore newsletters" but observation shows they read certain newsletters carefully — the diary surfaces the divergence in the thinking layer. The agent never silently overrides the declaration nor silently maintains a private model that contradicts it. Both reads have evidence; the diary treats divergence as content worth seeing. (See [01-anchor-model.md](01-anchor-model.md) on the principal-anchor's role.)

Principles × declared × observed applied to the principal themselves. Divergences are signal.

## Fields

`profile.md` is free-form markdown. The principal writes prose. The cold-start agent extracts structure on first read and writes it into the principal-anchor's slow layer; subsequent mtime-triggered re-reads update the slow layer in place.

Every field is optional. Defaults apply when fields are absent; defaults that fire are noted in the diary's thinking layer.

### Identity

Free-form prose. Who the principal is, role, context, what they're working on. Becomes the principal-anchor's slow-layer biographical content.

**Default if absent**: minimal — the tool reads name from system metadata if available, otherwise marks slow layer `precision: 0.1` with the note "no identity declared; inferring from observation."

**Example (Avery)**: "I'm Avery Chen, co-founder and CEO of Tessera, a 12-person B2B SaaS company doing supply-chain visibility for mid-market manufacturers. I'm 37. I live in Oakland with my partner Sam and our 4-year-old, Wren. This is my second company; the first one sold to a logistics incumbent in 2020 for not very much."

### What a great digest looks like to me

Free-form prose. The principal's stated definition of quality. Loaded as a per-principal appendix to the disposition's universal criteria.

**Default if absent**: disposition's universal criteria used unmodified.

**Example**: "A great digest answers three questions in under 90 seconds of reading: (1) what needs me today? (2) what am I about to drop? (3) what can I dispatch right now? A bad digest tells me about my own calendar like I haven't seen it, summarizes threads I just sent, or pretends a marketing newsletter is news."

### People who matter

List of names with role descriptions and signal levels. Each entry is a hint the mind agent uses when deciding what to do with a subject — names plus role tokens become identity-handle hints for matching events; signal level biases the entity-vs-anchor judgment at creation time and the later promotion call. Cold-start does not pre-create anchors for these names. They enter as entities (or, for unambiguous high-signal first sights, as anchors) and earn or extend anchor status through evidence.

Signal levels follow `P0 / P1 / P2 / P3 / P4` (or equivalent ordinal language — "high," "important," "background"; the agent normalizes). Lower number = higher signal.

**Default if absent**: no per-principal signal weighting. Entities and anchors emerge purely from observation.

**Example (Avery, abbreviated)**:

- Sam Park (partner) — P0. Personal.
- Priya Iyer (co-founder, CTO) — P0. If she emails instead of slacks, it's intentional.
- Marcus Webb (Series A lead at Inflection Point Ventures) — P0 during the raise. Do not miss replies.
- Diane Okafor (board member) — P1. Patient but owed quarterly updates.
- Recruiters cold-emailing — P4. Don't draft. Don't surface unless 3+ from same firm in a week.

### Suppression rules

Free-form prose or list. What the principal explicitly does not want surfaced.

**Default if absent**: disposition's universal suppression (newsletters, marketing, FYI-only).

**Example**: "Newsletters. Even Stratechery. Calendar invites I already accepted. Marketing emails. Long threads where I've already had the last word and nobody else has replied. Anything where the only action is FYI."

### What I might miss without help

Free-form prose. The principal's meta-awareness of their blind spots. Biases the agent's surfacing discipline toward those areas.

**Default if absent**: no per-principal surfacing bias; disposition's universal rules apply.

**Example**: "Quiet investor threads after three business days. Customer health signals buried in support threads. Calendar collisions involving Wren's daycare, doctor appointments, or anything Sam put on our shared calendar. Promises I made in email I haven't written down. Hiring loops that have stalled."

This field is unusually load-bearing. It tells the agent which plays to weight most heavily. Avery's "quiet investor threads" maps to `important-person-quiet-too-long` and `stalled-thread-near-milestone`; "promises in email I haven't written down" maps to `commitment-made-in-thread-not-on-notes`; "calendar collisions involving Wren" maps to `calendar-collision-family-event`.

### Notes I keep

Free-form prose. Where and how the principal keeps written notes — running todos, project files, decision logs, journals. Context for the agent about how the principal works; the digest does not directly observe external note corpora. To put something into the digest's awareness, use `diary_add_note`.

Notes are one of the configured event sources (see `event_sources` in [10-config.md](10-config.md)). Todos live inside notes: any list, checklist, or "thing to do later" is plain text the mind agent treats as observation. There is no separate task source; promises and todos surface as ordinary diary components when the agent reads them as relevant.

**Default if absent**: the agent reads notes as generic prose without principal-specific framing.

**Example**: "I keep a running todo list in Obsidian under `daily-notes/`. Project notes live in `projects/<slug>/`. Anything in `journal/` is private — read it for context but never surface it in the diary."

### Tone for drafted replies

Free-form prose. The principal's voice register. Loaded into the diary agent's draft step.

**Default if absent**: the diary agent's universal voice register (brief, warm, direct, no chirpy adjectives).

**Example**: "Short. Lowercase greetings or none at all. Sign off with 'Avery' or nothing. No 'I hope this email finds you well.' No 'circling back.' No 'just wanted to.' Direct but not cold. Warmth comes from specificity. For investors during the raise, slightly more polished. For Sam: don't draft. Surface and let me write."

### Things to be honest about

Free-form prose. The principal's stated honesty contract. Sets the disposition's uncertainty discipline.

**Default if absent**: disposition's universal honesty discipline.

**Example**: "If the inbox data is older than 24 hours, say so. If you can't tell whether a thread is urgent, say I'm not sure and show me the thread. If you drafted a reply based on assumptions, flag the assumptions. If two sources disagree, tell me — don't pick one and hide it."

### What "today" means

Free-form prose. The principal's day boundary.

**Default if absent**: midnight-to-midnight in the principal's timezone (from `config.jsonc`); "today" includes anything needing reply before midnight tonight.

**Example**: "Pacific time. My day starts at 6am. The morning digest runs at 6:00am sharp. Today in the digest means today's calendar plus anything that needs a reply before midnight Pacific."

## What does NOT belong in profile.md

Operational settings (timezone, diary cadence, event sources, MCP servers, model selection, webhook URL) live in `config.jsonc`. The boundary: `profile.md` is what the agent should know about the principal; `config.jsonc` is what the runtime needs to operate. See [10-config.md](10-config.md).

## The `--customize=<file>` override

The diary agent can be invoked with a per-invocation override prompt:

```
digest run --customize=hiring-focus.md
```

The named file is loaded **as an overlay on the default disposition** — appended to the diary agent's system context, *in addition to* (not instead of) the default disposition. It influences the read for that invocation only. It does not modify `profile.md`, does not modify the principal-anchor, and does not persist past the single invocation.

Use cases:

- "Today only, focus on hiring." A file biasing surfacing toward hiring threads and the `hiring-loop-stalled` play.
- "This week, emphasize Series A." A file elevating investor anchors and milestone-bound threads.
- "Walking into a board meeting — what do I need to know?" A file pulling heavily from the Diane anchor and the board-update note.

When `--customize` is absent, the disposition runs unmodified. The override is per-invocation, not per-principal — the right tool when the principal wants a different read on a specific day, the wrong tool when they want a permanent shift (that goes in `profile.md`).

The override file's format is free-form prose — the same disposition voice register, no special schema.

## Defaults summary

| Field | Default if absent |
|---|---|
| Identity | Minimal; principal-anchor slow layer marked low-precision |
| What a great digest looks like to me | Disposition's universal criteria |
| People who matter | None weighted; entities emerge from observation |
| Suppression rules | Disposition's universal suppression |
| What I might miss without help | No per-principal surfacing bias |
| Notes I keep | No principal-specific framing of notes |
| Tone for drafted replies | Diary agent's universal voice register |
| Things to be honest about | Disposition's universal honesty discipline |
| What "today" means | Midnight-to-midnight in principal's timezone (from `config.jsonc`) |

Every default that fires is noted in the diary's thinking layer. For operational defaults, see [10-config.md](10-config.md).

## The Avery example

Avery's `profile.md` maps to the schema as follows. The cold-start agent extracts structure into the principal-anchor's slow layer; the original `profile.md` is preserved unchanged.

```json
{
  "identity": "Avery Chen, co-founder and CEO of Tessera (12-person B2B SaaS, supply-chain visibility for mid-market manufacturers). 37, lives in Oakland with partner Sam and 4-year-old Wren. Second company; first sold to a logistics incumbent in 2020. Tessera is at ~$3.2M ARR, raised a $6M seed 14 months ago, currently in early Series A raise.",

  "what_a_great_digest_looks_like": "Answers three questions in <90s: what needs me today, what am I about to drop, what can I dispatch right now. Bad digest: tells me about my own calendar, summarizes threads I just sent, pretends a marketing newsletter is news.",

  "people_who_matter": [
    {"name": "Sam Park",              "role": "partner",                                    "signal": "P0", "note": "personal"},
    {"name": "Priya Iyer",            "role": "co-founder, CTO",                            "signal": "P0", "note": "email-instead-of-slack is intentional"},
    {"name": "Marcus Webb",           "role": "Series A lead at Inflection Point Ventures", "signal": "P0", "note": "do not miss replies during the raise"},
    {"name": "Diane Okafor",          "role": "board member, prior seed lead",              "signal": "P1", "note": "owed quarterly updates"},
    {"name": "Jordan Liu",            "role": "Head of Eng",                                "signal": "P1", "note": "escalates rarely; when he does, listen"},
    {"name": "Tomás Reyes",           "role": "Head of GTM",                                "signal": "P1", "note": "emails too much; find the one thing that matters"},
    {"name": "Ben Schaffer",          "role": "lawyer (Wilson Sonsini)",                    "signal": "P0_during_raise_P2_otherwise"},
    {"name": "Halberd / Northstar / Veritas procurement leads", "role": "reference customers", "signal": "P1", "note": "same-day reply, period"},
    {"name": "cold recruiters",       "role": "outbound",                                   "signal": "P4", "note": "surface as pattern (3+ from same firm in a week), not as instances"}
  ],

  "suppression_rules": "Newsletters (incl. Stratechery). Already-accepted calendar invites. Marketing emails. Long threads where I had the last word and nobody replied. FYI-only emails.",

  "what_i_might_miss": "Quiet investor threads (>3 business days). Customer health signals in support threads. Calendar collisions involving Wren or Sam's shared calendar. Promises in email I haven't written down. Stalled hiring loops (5+ days no movement).",

  "notes_i_keep": "Running todos and meeting notes in Obsidian under daily-notes/. Project notes in projects/<slug>/. journal/ is private — read for context but never surface.",

  "tone_for_drafts": "Short (1-3 sentences). Lowercase greetings or none. Sign off \"Avery\" or nothing. No \"hope this finds you well,\" \"circling back,\" \"just wanted to.\" Direct but not cold; warmth from specificity. Investors: slightly more polished. Sam: don't draft; surface only.",

  "things_to_be_honest_about": "Stale data (>24h). Uncertainty about urgency. Assumptions in drafted replies. Source contradictions (don't silently pick one).",

  "what_today_means": "Pacific time, day starts at 6am, \"today\" = today's calendar + anything needing reply before midnight Pacific."
}
```

The extracted form makes a few things explicit that were prose:

- **Marcus Webb** earns a seeded fact-kind prediction on his entity-then-anchor — reply-cadence violation fires after three business days (see [01-anchor-model.md](01-anchor-model.md) on prediction kinds).
- **Cold recruiters** becomes a pattern-suppression rule the `recruiter-pattern-suppression` play consults: individual recruiter emails suppressed; play surfaces at the pattern threshold (3+ from one firm in a week).
- **Sam: don't draft, surface only** becomes a constraint on the diary agent's draft step: when the recipient is the Sam anchor, the agent emits a `free-text-reply` component instead of an `email-draft`.
- **Obsidian todos** tells the agent that any checklist-shaped text in `daily-notes/` is a promise the principal made to themselves — material for surfacing, not for executing.

(Avery's `config.jsonc` — timezone, diary schedule, event sources, MCP servers, webhook URL — is in [10-config.md](10-config.md).)

## Customization for different principals

A different principal — say, a public-company CEO running a large org — produces a `profile.md` that looks substantially different from Avery's:

- Different P0 list (board chair, CFO, CMO, general counsel; no co-founder; no individual customers).
- Different suppression rules (institutional newsletters an EA filters; internal all-hands summaries; investor-update digests they author).
- Different "what I might miss" (M&A signals, regulatory deadlines, executive-team interpersonal drift).
- Different schedule in `config.jsonc` (`["05:30"]` morning-only; rest goes to an EA).
- Different event sources and MCP servers (Exchange via Gmail-compatible bridge; corporate Notion as notes MCP).

The tool hardcodes no preferences. Disposition encodes universal principles; the principal-anchor holds specifics; plays encode situation-level judgment that generalizes. Same code, same prompts, same plays — different `profile.md`, different sources — produce a digest shaped for a different principal.
