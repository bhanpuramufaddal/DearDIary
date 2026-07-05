# Plays — The Cognitive Precedent Library

A **play** is a case map for how a thoughtful triage agent should *think through* a recurring kind of moment. Plays live in the **`plays` table** in `digest.db` — one row per play (`name`, `title`, `content`, `derived_from`, `created_at`). The mind agent and diary agent read plays as precedent, not as rules.

Two sources populate the table. **House plays** ship with the tool as bundled markdown under `prompts/seed-plays/` and are upserted into the table at every boot (`src/main/db/seedPlays.ts`) — generic reasoning, how-to, and triage precedents that apply to any principal. **Persona plays** are derived once, by the cold-start agent, from the principal's observed history and written via `create_play`. The result is a precedent library that is part generic-and-stable, part custom-to-this-principal.

> **Note — this supersedes the original "static markdown, no self-authoring" design.** The first cut shipped a fixed set of ten human-authored markdown files under `~/digest/plays/` and explicitly rejected agent self-authoring. The backend refactor moved plays into SQLite and gave cold-start a `create_play` tool so the library can be tailored to the principal at seeding time. The "Authoring discipline" section below describes the current design; the rejection is kept only as rationale for *why authoring is confined to cold-start* rather than running continuously.

This doc specifies the shape, the discipline, and the shipping library. See [03a-agent-shape.md](03a-agent-shape.md) for how agents access plays via tool calls.

## What a play is

Precedent material. It describes a kind of situation — a stalled investor thread near a milestone, a quiet customer, a calendar collision involving family — and surveys how a thoughtful agent would think about it. It names what shapes the read, what moves are available, what to avoid, and what past cases anchor the agent's intuition.

The cognitive opening when reading a play is **"let me see what I can do here,"** not **"let me execute play X."** Plays inform reasoning; they do not direct it.

This is **RPDM precedent discipline** — recognition-primed decision-making. The expert recognizes the current situation against a library of past situations and forms a situated response, rather than matching against rules and executing the matched rule. The play is the precedent; the reasoning happens in the agent's working context, informed by the play's framing but not constrained by it.

## What a play is not

The discipline is most legible by negation.

- **Not a gate.** "When stalled-thread-near-milestone is detected, surface Marcus" is the failure mode. The play informs the read; the read decides what to surface.
- **Not a few-shot example.** Few-shots are matched at retrieval and conditioned on. Plays are read for their reasoning, not their pattern.
- **Not a deterministic template.** Two situations matching the same play produce two different reads because the specifics differ.
- **Not a script or procedure.** Procedural how-to ("how to send an email via Gmail") lives in the calling agent's skill system. Plays are about *judgment about kinds of moments*, not *steps for kinds of actions*.

When a play reads like a flowchart, it was written wrong. When it reads like a thoughtful agent's interior monologue about a kind of situation, it was written right.

## Play shape

Each play is a `plays` row whose `content` column holds markdown. House plays are authored as files under `prompts/seed-plays/<prefix>-<slug>.md` (the filename maps to the row `name` as `<prefix>:<slug>` — e.g. `triage-busy-morning.md` → `triage:busy-morning`); cold-start writes persona plays directly to the table. Either way the `content` follows a consistent structure so the agent can rely on the shape:

```markdown
# <Play title>

## The situation
A concrete description of the kind of moment. Names specific observable
inputs that constitute the moment. Not "an investor is unhappy" but
"a thread with an active-raise investor has been quiet longer than that
investor's normal cadence, and a deliverable they asked for hasn't landed."

## What shapes the read
The texture the agent reads before committing. Each bullet names a question:
- The counterparty's normal reply curve (anchor mid-layer pattern data)
- The milestone's slack — days or hours?
- Who owes the next move?
- Are side-channels showing activity that contradicts the apparent silence?

## The space of moves
Real options, each annotated with when it lands:
- Surface the silence in the diary, flagged with the milestone
- Draft a polite-chase reply if silence is longer than pattern
- Escalate framing only when the milestone is hours away
- Wait silently if the counterparty's pattern hasn't elapsed yet

## What NOT to do
Failure modes specific to this kind of moment. Not generic advice.

## Past cases
For each case: date, situation, what happened, what worked or didn't.
- 2026-04-12: Marcus quiet 5 days mid-term-sheet. Polite-chase resolved
  within 6h.

## Currently
The most important section. Tells the agent **when this play is in scope.**
Written as the agent's current read of applicability:
"This play applies when an anchor's mid-layer notes an open thread, an
associated prediction's expected resolution has passed or is within 24h,
AND the counterparty's anchor pattern data shows reply cadence is being
violated."
```

Not every section is required. **"Currently" is the most load-bearing** — it is the gate the agent uses to decide whether the play is in scope. Plays without a "Currently" section default to "always consider," which is rarely right.

Concrete example:

```markdown
# Stalled Thread Near Milestone

## The situation
A thread with an important counterparty has gone quiet, and a deadline
or commitment depends on it resuming. Examples: a customer waiting on a
feature ship date, an investor expecting term-sheet movement, a candidate
waiting on an offer response.

## What shapes the read
- The counterparty's normal reply curve (anchor mid-layer pattern data)
- The milestone's slack — is it days or hours away?
- Who owes the next move — us or them?
- Are there parallel side-channels (Slack, calendar) showing activity
  that contradicts the apparent silence?
- Has this counterparty stalled before in a similar way? How did it
  resolve?

## The space of moves
- Surface the silence in the diary as a Tracking component, flagged
  with the milestone and the expected-reply window
- Draft a polite-chase reply (email-draft component) if it's been longer
  than the counterparty's pattern indicates
- Escalate framing only if the milestone is hours away and the chase
  already went unanswered
- Wait silently if the counterparty's pattern suggests they batch-reply
  on a known schedule that hasn't elapsed yet

## What NOT to do
- Don't surface every quiet thread — quietness alone isn't signal. The
  threshold is "quiet relative to this counterparty's normal pattern AND
  a milestone is approaching."
- Don't compose a single-message escalation. Multi-step chases come in
  stages (polite → firm → escalated); only the next stage is the
  current move.

## Past cases
- 2026-04-12: Marcus went quiet 5 days mid-term-sheet. Polite-chase
  resolved within 6h.
- 2026-03-18: Halberd's procurement lead quiet 8 days near rollout date.
  Required escalation through Tomás's relationship.

## Currently
This play applies when: an anchor's mid-layer notes an open thread, an
associated prediction's expected resolution has passed or is within 24h,
AND the counterparty's anchor pattern data shows reply cadence is being
violated.
```

The voice is the agent's interior thinking about the kind of moment. Dry, situated, willing to admit uncertainty.

## The house library

The bundled house plays under `prompts/seed-plays/` (seeded at boot) fall into three families, named by filename prefix:

- **`reasoning:*`** — domain-agnostic thinking moves the agent reaches for mid-deliberation: `aggregate`, `anchor-in-retrieval`, `attend-to-whats-missing`, `branch-with-closure`, `earn-every-hesitation`, `land-with-falsifier`, `mental-simulation`, `notice-and-name`, `reframe-meta-level`, `return-to-earlier-notes`, `story-shape-recall`, `verify-load-bearing`. These are precedents about *how to reason*, not about a kind of inbox moment.
- **`howto:*`** — `situation-handling`, `suppression`, `voice`. Cross-cutting craft guidance the diary agent consults while composing.
- **`triage:*`** — `busy-morning`, `quiet-morning`, `recurring-matter`. Precedents for the overall shape of a diary tick under different load.

Note the shift from the original design: the old ten plays were all **domain-specific triage situations** (stalled investor thread, declining-customer cadence, hiring-loop stalled, …). Those are exactly the precedents that now arrive as **persona plays** — cold-start derives them from how *this* principal actually handles an investor update, a customer escalation, a calendar/family conflict. The house library stays generic; the persona-specific judgment is learned per-principal at seeding. Each play is approximately one page; the goal is still a precedent library, not a procedure manual.

## Authoring discipline

**House plays ship with the tool. Persona plays are authored once, at cold-start. The runtime agents do not author plays.**

Authoring is deliberately confined to the cold-start agent — the one-shot seeding pass that reads the principal's history. It is **not** available to the mind or diary agents at runtime. The three original objections to self-authoring still hold; confining authoring to cold-start is how each is answered rather than ignored:

1. **Quality control.** A continuously self-authoring agent needs gating about when a pattern is real enough to absorb — its own design problem, easy to get wrong, prone to drift. Cold-start authors against the *whole observed window at once*, with the explicit goal of generalizing recurring handling, so the pattern is established before a play is written rather than guessed at from a single event.
2. **Library size.** Continuous authoring grows the library monotonically. A single seeding pass produces a bounded set sized to the principal's actual recurring matters; the library does not creep with every tick.
3. **Trust.** Persona plays carry `derived_from` — the source IDs they generalize from — so a play is auditable back to the behavior it was learned from. The principal (via the Inspector) can read every play and see its provenance; house plays remain human-authored and stable.

A principal who wants a new generic precedent still files a feature request and it ships as a house play. What changed: the system no longer pretends every principal's recurring situations are knowable in advance — cold-start learns them once, from real history, and the mind/diary agents read them but never write them.

## No manuals

Adjacent agent architectures pair plays with **manuals** — procedural runbooks like "how to send an email via the Gmail API." Manuals encode procedural how-to; plays encode judgment.

This tool **does not have manuals.** The tool does not execute actions on the world; the calling agent (Claude Code) does, and its skill system already encodes procedural know-how for sending email, accepting invites, marking tasks done. Duplicating that in the digest tool would be redundant and would invite drift.

Plays remain — the judgment layer — because judgment about *kinds of moments* is the tool's competency. The architectural cut is clean: only plays.

## How plays enter agent context

Plays are not embedded in agent prompts. They live in the `plays` table and are loaded via `run_sql` — the same read tool the agent uses for the rest of the substrate (see [03a-agent-shape.md](03a-agent-shape.md)).

The agent's pattern: a cheap scan first — `SELECT name, title FROM plays` (or a `title`/`name` filter) to see what is in the library, then `SELECT content FROM plays WHERE name = ?` for each play it wants to reason from. Reading a play is intentional and per-tick, not implicit context loading. (Authoring, when it happens, is the cold-start agent's `create_play` — a write, not a read; the mind and diary agents have read-only access to the table.)

Why `run_sql` and not prompt embedding:

1. **Cheap context.** A diary tick that doesn't need any play doesn't load the library. Most ticks only need two or three.
2. **Library can grow.** House plays plus per-principal persona plays can total more than a fixed handful; embedding would force pagination. A `SELECT` paginates and filters natively.
3. **Auditable selection.** Which plays the agent loaded for a given tick is visible in its `run_sql` tool-call trace.

When two or more plays apply — common — the agent reads each, mentally simulates the response each implies, and either acts on the first that simulates well or synthesizes across plays. This is RPDM-across-cases. If the reconciliation was nontrivial, the diary agent notes it briefly in the thinking layer.

## Cross-references

Plays reference anchors and other plays by **prose mention**, not structured field. "Past cases" cites source IDs (`gmail:<msg>`, `gcal:<event>`) and anchor names in prose; "Currently" refers to anchor layers and predictions by their semantic name. The cognitive layer does not maintain a play-to-anchor index; the agent resolves references by reading.

This matches the broader discipline: structured fields where the cognitive layer operates (identity handles, source IDs, prediction dates); prose where the agent reasons (anchor layer content, play sections, diary speech layer).
