# Reasoning Traces, Not Schema Completion

The core authoring principle. Every other design decision serves it.

## The failure mode this avoids

Earlier iterations over-mechanized. We asked the LLM to fill schema slots — Big Five values, elevator/dampener tables, `_synth_metadata.exercises[].expected_outcome`, `character_traits_invoked` references. This pushed the model toward shallow tag-completion. The resulting data felt lifeless.

Two specific failures the pipeline structurally prevents:

**Failure 1 — schema completion.** Asking the LLM to fill JSON / YAML fields with values. Outputs become `personality.neuroticism = 0.58`, `current_goals: [build_runway, hire_eng_lead]`. Looks structured. Reads dead.

**Failure 2 — entity-list-as-derivation.** Subtler. The prompt asks for narrative, but the narrative degenerates into bulleted entity references: `characters: [marcus, ben]`, `activates_overrides: [no_newsletters]`, `biases_invoked: [loss_aversion, status_quo]`. This *looks* like reasoning but is still mechanical — it lists what's connected without explaining *how* or *why*.

## The principle

Each load-bearing decision is captured as a **reasoning paragraph** — prose that walks through context, considers alternatives, lands on a conclusion. Entities are named in the prose as **subjects of sentences**, not as items in a list. Structure is extracted from paragraphs only where code needs it, and even then it's the thinnest possible sidecar.

Concretely: a storyline's narrative arc names Marcus, Ben, and Diane *inside sentences* explaining their roles, stakes, and dynamics. It does not contain a `characters: [marcus, ben, diane]` block. A judgment essay walks through how Avery decides what matters this month, with worked examples. It does not contain a `dimensions × elevators × dampeners` JSON.

## Concrete shifts

| Decision | Old (schema or entity-list) | New (reasoning trace) |
|---|---|---|
| Persona personality | `{openness: 0.78, neuroticism: 0.58, ...}` prelude | Biographical narrative; Big Five surfaces in prose where it's load-bearing |
| Judgment model | JSON: `dimensions × elevators × dampeners × tie_breakers` | Essay: *"How Avery decides what matters this month"* — walks through attention patterns with worked examples |
| Storyline | `characters: [cast_marcus, cast_ben, cast_diane]` + `channels: [...]` + `activates_overrides: [...]` | A narrative arc that names Marcus, Ben, Diane inside sentences explaining their roles, stakes, and dynamics |
| Cast interiority | `current_goals: [...]`, `their_view_of_persona: "..."`, `communication_quirks: [...]` | A paragraph per P0–P1 character describing who they are, what they want, how they read the persona, where they go quiet |
| Day state | `state_day_NN.json` with `carryovers[]`, `storyline_states{}`, `active_elevators[]` arrays | Daily journal entry mentioning the cap-table commitment by name, describing how its weight changed since yesterday |
| Per-artifact tagging | `exercises: [loss_aversion_under_raise, carryover_pressure_self]` | Reasoning paragraph explaining why this artifact lands the way it does for this persona on this day; biases mentioned by name as they apply |
| Ideal digest item | Structured `expected_outcome` dict per item | Conclusion at the end of the artifact's reasoning trace; extracted by a narrow LLM call at Stage 9 |

## Where structure stays

Some things are structural by nature. Markdown reasoning serves them poorly. These live in `persona.db` (see [10-storage.md](10-storage.md)) — one row per record, indexed and queryable:

- **Identity** — the `personas` table (slug, name, prompt text, seed, window dates).
- **Cast index** — the `cast` table: `(cast_id, display_name, signal_tier)`. The prose interiority lives in `internal/cast.md`; the table is just the cross-reference target.
- **Storyline index** — the `storylines` table: `(storyline_id, display_name, arc_path)`. Arc prose lives in `internal/storylines/<id>/arc.md`.
- **Declared digest moments, noise events, noise effects, planned artifacts** — `declared_moments`, `noise_events`, `noise_effects`, `planned_artifacts` tables. Authored at Stage 5.
- **Emails, notes, calendar ops, initial calendar events** — `emails`, `notes`, `calendar_ops`, `initial_calendar_events`. Served by the mail / calendar / notes service emulators as `.eml` (RFC 822) and `.ics` (iCalendar) on demand.
- **Validation outcomes** — `validation_log`. One row per active declared moment with pass/fail/correct.
- **Observability** — `agent_runs`, `agent_tool_calls`, `llm_calls`.

The one structured output still on disk is `ideal_digests/morning_NN.json` — Stage 9b's eval target, written from a SQL query. Every field traces to its source row.

Everything else is markdown reasoning.

## How this shows up at each stage

The reasoning-traces principle is enforced by *how the prompt is written* and *what tools the agent has*.

- The character sketch is markdown, 2–4K words, no schema. The agent has `Read`, `Write`, `Edit` — no structured-output tools to bias it toward filling slots.
- The judgment doc is an essay. Same.
- The storyline plan is markdown, but the agent also has `declare_digest_moment`, `declare_noise_event`, and `declare_planned_artifact` typed tools. The narrative arc is prose; the *declarative* skeleton (target morning, supporting artifact IDs, lifecycle effects) is structured. The split is principled: prose explains *why*; structure tracks *what*.
- Stage 7 has no structured-output tool for digest items — it cannot declare moments. It only renders pre-declared events. This is what enforces "no plot authority."

The structured-output tools are pydantic-validated. The LLM never generates JSON as free text. Schema enforcement lives in code, not in the LLM's text generation. See [01-design-decisions.md §Agent loop](01-design-decisions.md#agent-loop-is-the-default).

## What this earns

- Depth where depth matters: the back-stage truth in `character_sketch.md`, the judgment essay, the storyline arc.
- Structure where structure matters: cross-doc references, calendar ops, eval ground truth.
- No drift toward tag-completion: the prompts explicitly forbid `characters: [...]` style lists inside the prose docs.
- Cross-doc consistency: the same Marcus appears in the cast paragraph, in three storyline arcs, in daily-state entries — by name, in sentences, with consistent voice.

The verification rule is simple: open any prose doc. If you see bulleted entity references where there should be sentences, the framework has slipped back toward entity-list-as-derivation. Rewrite the prompt, not the doc.
