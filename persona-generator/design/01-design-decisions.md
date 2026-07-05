# Design Decisions

The top-line architectural choices, why they were made, and when each applies. See [02-orchestration.md](02-orchestration.md) for the LangGraph orchestration detail referenced in the last row.

## Decisions table

| Decision | Choice | Rationale |
|---|---|---|
| **Generation strategy** | Pure LLM (Opus 4.7), reasoning-trace-first, agent loop as default execution mode | Schemas push the LLM to tag-completion; reasoning traces preserve depth. |
| **Execution mode** | Agent loop (via `claude-agent-sdk`) for every LLM-touching stage. Stage 8B (deterministic calendar replay) has been absorbed into the calendar service emulator and is no longer a separate pipeline step. | Long inputs + multi-page outputs + structured outputs all push past single-completion limits. Agents read upstream files paginated; emit structured outputs via typed tools. |
| **Orchestration** | LangGraph between stages — graph topology, shared state flow, parallel branches, conditional edges (retries, skip-if-complete), SQLite checkpointing | The pipeline IS a state machine over a graph: sequential foundation, parallel post-Stage-7 branches, internal cascade in Stage 7, internal fan-out in Stage 9. |
| **Input interface** | Free-form prompt only — no pins, no spec-file, no diversify flags | Minimum surface area; one universal front door. |
| **Data window** | 35 days, 2026-04-19 → 2026-05-23 | Days 1–5 warm-up + Days 6–35 eval window. |
| **Warm-up period** | Days 1–5: lived, NO digest, agent doesn't run | Builds carryovers, storyline pressure, calendar history so Day 6+ digests face realistic accumulation. |
| **Eval window** | Days 6–35: 30 mornings, ideal digest generated, agent runs once each morning | Brief's sample digest (May 21) lands as Day 33. |
| **Authoring direction** | Storyline-first. Stage 5 authors complete storyline plans (narrative arc + declared digest moments + noise events with effects + planned artifacts). Stage 7 renders pre-declared events in persona voice; it has no plot authority. | Earlier "artifacts-first, infer digest downstream" model accumulated special cases. Declaring moments upstream eliminates inference and gives noise events a clean handle. See [04-storyline-authoring.md](04-storyline-authoring.md). |
| **Digest item lifecycle** | Declared moments have states: `DECLARED` / `CANCELED` / `SHIFTED` / `MODIFIED`. Noise events carry `occurrence_date` plus per-effect `effective_from` so multi-day cascades are first-class. | Time-shifted items (a Day-8 reschedule shifts a Day-13 IC to Day-16) become temporal arithmetic, not narrative gymnastics. |
| **Stage 9 = Validation + Assembly** | Single eval-output stage with two internal phases. 9a Validation: parallel-per-moment LLM agents check each active moment against the persona's actual past, emitting `pass` / `fail` / `correct`. 9b Assembly: deterministic walk over plans + validation_log, emitting `ideal_digests/morning_NN.json`. | Verification is easier than generation; assembly is bookkeeping. Folding both under Stage 9 reflects the cognitive weight honestly. See [08-validation-and-assembly.md](08-validation-and-assembly.md). |
| **4 reference personas** | `avery_chen` · `vikram_mehta` · `dana_levin` · `aisha_williams` | Stress-test the engine across very different professions. See [05-personas.md](05-personas.md). |
| **Model** | Opus 4.7 for every stage | One model end-to-end; consistent quality. |
| **Storage layer** | Structured records (emails, calendar ops, declared moments, noise events, validation log, observability) live in a per-persona SQLite DB at `data/personas/<slug>/persona.db`. Prose stays as markdown files. The service emulator generates `.eml` / `.ics` on the fly from DB rows. | Tabular things with repeatable schemas belong in SQL — querying, joins, indexed lookups are natural. Prose stays in files because forcing it into TEXT columns adds no query value. Single source of truth; no file ↔ DB sync. See [10-storage.md](10-storage.md). |
| **ORM** | SQLModel (Pydantic + SQLAlchemy 2.0). One class per table doubles as the agent's structured-tool argument schema. | Same shape on both sides means no schema drift between the tool's pydantic model and the row written. |
| **Artifact formats (digest sees)** | `.eml` (RFC 822), `.ics`, `.md` — served by the mail / calendar / notes service emulator from DB rows on demand. The digest never reads `persona.db` directly. | Real formats only at the digest boundary. The agent's interface is production-shaped (MCP tools + REST), not a synthetic file walk. See [09-output-formats.md](09-output-formats.md). |
| **Internal scaffolding** | Markdown reasoning prose (life context, character, judgment, cast, day archetypes, channels, storyline arcs, daily state). Anything tabular is in SQL. | Depth lives in prose; structure is in the DB. |
| **Theoretical grounding** | Goffman + Big Five + behavioral biases + Granovetter ties + multi-role identity | Vocabulary in prose, never schemas to fill. |
| **Eval** | Stage 9 produces structured ideal digests for Days 6–35 via narrow extraction from upstream traces. The agent calls `add_digest_item` / `add_suppression` typed tools — no free-form JSON. | The compiler extracts — it doesn't re-judge. Schema validation is in the tool, not in the LLM's text generation. |
| **Prompt authorship** | Meta-prompted: we used the LLM itself to write every stage prompt (one-time dev-time setup). Prompts are agent system prompts that declare the toolset and termination conditions. | We don't hand-author prompts; Claude writes them given the plan and stage spec. |

## Agent loop is the default

Three conditions push a stage to agent-loop mode instead of a single completion. Combined across the pipeline, agent loop becomes the default for every LLM-touching stage.

1. **Multi-page output.** Stages producing output too large for a single completion to hold without quality degradation — `character_sketch.md` (2–4K words), `judgment.md` as a multi-section essay, storylines across 5–10 arcs, Stage 7's per-day output spanning activity-log entry + daily-state + N planted-artifact traces + calendar ops.
2. **Long input.** Stages reading enough upstream context (~15–25K words once `character_sketch.md` + `judgment.md` + `cast.md` + `storylines.md` exist) that stuffing it all into the system prompt is wasteful. The agent reads files paginated, on demand.
3. **Structured output.** Stages producing JSON / JSONL / YAML / `.eml` / `.ics`. Free-form JSON-mode completion is brittle. The agent calls typed, pydantic-validated tools (`add_digest_item`, `add_calendar_op`, `emit_email`, `write_persona_spec`, etc.) that validate inputs and append/write to the appropriate file. Schema enforcement lives in code, not in the LLM's text generation.

### Two tool families per agent

- **File tools** (from `claude-agent-sdk`): `Read` (paginated), `Write`, `Edit`, `Glob`, `Grep`. Working directory scoped to `data/<slug>/`. No `Bash`, no web tools, no sub-agents.
- **Structured-output tools** (custom, pydantic-validated, SQLModel-backed): one tool per artifact kind. The tools INSERT rows into `persona.db` — they no longer write files. `write_persona_spec` inserts into `personas`; `add_cast_member` inserts into `cast`; `add_calendar_op` inserts into `calendar_ops`; `emit_email` inserts into `emails`; `add_digest_item` (Stage 9b assembly) appends an item to the morning's JSON output. The agent calls each by name with typed arguments; pydantic validates and SQLModel commits. See [10-storage.md](10-storage.md).

### Stage execution classification

| Stage | Mode | File tools | Structured tools |
|---|---|---|---|
| 0 Spec Seed | Agent | Write | `write_persona_spec` |
| 1a Life Context | Agent | Read, Write, Edit | — |
| 1b Character Sketch | Agent | Read, Write, Edit | — |
| 1c Judgment | Agent | Read, Write, Edit | — |
| 1d Profile.md | Agent | Read, Write | — |
| 2 Cast | Agent | Read, Write, Edit | `add_cast_member` |
| 3 Day Archetypes | Agent | Read, Write | — |
| 4 Channels | Agent | Read, Write | — |
| 5 Storylines + plans | Agent | Read, Write, Edit | `add_storyline`, `declare_digest_moment`, `declare_noise_event`, `declare_planned_artifact` |
| 6 Window Plan | Agent | Read, Write | `add_initial_calendar_event` |
| 7 Living the Day × 35 (rendering only) | Agent | Read, Write, Edit, Glob | `emit_email`, `write_note`, `add_calendar_op` |
| 8A Artifact Emission | Batched agent per persona | Read, Glob | `emit_email`, `write_note` (INSERT into `emails` / `notes`) |
| 8B Calendar Replay | — *(absorbed into calendar service emulator; no longer a pipeline step)* | — | — |
| 9a Validation | Agent — parallel-per-moment | Read, Glob | `validation_pass`, `validation_fail`, `validation_correct` (INSERT into `validation_log`) |
| 9b Assembly | **No LLM — single SQL query** that joins `declared_moments` ⋈ `noise_effects` ⋈ `validation_log`, writes 30 `ideal_digests/morning_NN.json` files | — | — |

### What this architecture eliminates

- **Single-completion JSON output.** Tools handle schema; no more "produce a JSON object" with structured-output mode.
- **The "structured envelope" pattern** in the old Stage 7 design (XML-tagged sections inside one completion). The agent writes each output to its real file using the appropriate tool.
- **`extract.py`** — the previous prose-to-structure bridge. Stage 9's agent emits items directly via `add_digest_item`.
- **`llm.py`'s single-completion wrapper** narrows or disappears; retries may be reused inside `agent_runtime.py`.

### New artifacts in the codebase

- `src/persona_generator/db.py` — opens / migrates the per-persona SQLite at `data/personas/<slug>/persona.db`, exposes a SQLModel `Session` factory.
- `src/persona_generator/models.py` — SQLModel classes for every table (`Persona`, `Storyline`, `DeclaredMoment`, `NoiseEvent`, `NoiseEffect`, `PlannedArtifact`, `Email`, `EmailAttachment`, `Note`, `InitialCalendarEvent`, `CalendarOp`, `Cast`, `ValidationLog`, `AgentRun`, `AgentToolCall`, `LlmCall`). One class per table; doubles as the typed schema for the structured-output tools.
- `src/persona_generator/agent_runtime.py` — wraps `claude-agent-sdk`. One function hosts the ReAct loop with the right system prompt, working directory, tool allowlist, JSONL turn logging, and post-run output verification (queries `persona.db` for expected rows, checks expected prose files on disk).
- `src/persona_generator/tools/` — one module per structured-output tool (`persona_spec.py`, `cast.py`, `storyline.py`, `declared_moment.py`, `noise_event.py`, `planned_artifact.py`, `initial_calendar.py`, `calendar_ops.py`, `email_emit.py`, `note_emit.py`, `validation.py`). Each imports its SQLModel class from `models.py` and INSERTs via the open session.

The LangGraph layer that schedules these agents — graph topology, shared state, retries, checkpointing — is covered in [02-orchestration.md](02-orchestration.md).
