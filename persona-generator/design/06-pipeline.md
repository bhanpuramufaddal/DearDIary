# The Ten-Stage Pipeline

A bird's-eye view of the ten stages, their dependencies, where parallelism opens up, and what each produces. Per-stage detail lives in [07-stage-details.md](07-stage-details.md).

## Topology

```
USER PROMPT (string)
  ↓
[0] Spec Seed                       → personas/<slug>.yaml (thin: slug, name, prompt, seed)
                                      + internal/persona_origin.md (intro narrative)
  ↓
[1] Persona Foundation (4 sub-stages, the architectural inversion)
    1a Life Context                 → internal/life_context.md  (situational backdrop)
    1b Character Sketch             → internal/character_sketch.md  (back-stage truth)
    1c Judgment Reasoning           → internal/judgment.md  (essay: how persona decides)
    1d Profile.md (DERIVED)         → profile.md  (front-stage compression — digest reads)
  ↓
[2] Cast                            → internal/cast.md  (prose: P0–P1 full, brief for others)
                                      INSERT rows into persona.db → cast (cast_id, tier)
[3] Day Archetypes                  → internal/day_archetypes.md
[4] Channels                        → internal/channels.md
[5] Storylines + plans              → internal/storylines/<storyline_id>/arc.md  (narrative arc prose)
    (the heaviest authoring stage)    INSERT rows into persona.db:
                                        → storylines, declared_moments,
                                          noise_events, noise_effects,
                                          planned_artifacts
[6] Window Plan                     → internal/window_plan.md  (35-day outline)
                                      INSERT rows into persona.db → initial_calendar_events
  ↓
[7] Living the 35 Days              → activity_log.md  (the spine: per-day narrative)
    × 35 sequential calls             + internal/daily_state/day_01..35.md  (markdown journals)
    (rendering only — no plot         INSERT rows into persona.db
     authority; Days 1–5 warm-up,        → emails, notes, calendar_ops
     Days 6–35 eval window)
  ↓
[8] Artifact Emission
    8A LLM Path                     INSERT rows into persona.db
                                      → emails table (with X-Synth-* extract columns)
                                      → notes table
    (8B Calendar Replay)            GONE — absorbed into the calendar service emulator,
                                      which generates .ics on demand from
                                      initial_calendar_events + calendar_ops rows.
  ↓
[9] Ideal Digest  (validation + assembly)
    9a Validation                   INSERT rows into persona.db
       (parallel-per-moment LLM        → validation_log table
        agents)                         (one row per active declared moment:
                                         pass / fail / correct + justification)
    9b Assembly                     SQL query joining declared_moments ⋈ noise_effects ⋈
       (single SQL query,             validation_log; writes 30 files:
        no LLM)                        → ideal_digests/morning_06..35.json
                                      → ideal_digests/morning_06..35.reasoning.md (optional)
```

See `diagrams/pipeline-architecture.excalidraw` for the visual; [02-orchestration.md](02-orchestration.md) covers the LangGraph implementation.

## Sequencing principles

**Stages 0 through 6 are strictly sequential.** Each reads everything the prior stages wrote. The cumulative context grows from a single prompt at Stage 0 to ~15–25K words of `character_sketch.md` + `judgment.md` + `cast.md` + `storylines.md` by Stage 6. Stage 7 reads all of it as paginated context.

**Stage 7 is sequential within itself, 35 days deep.** Each day reads yesterday's daily-state. The cascade IS the narrative — Day 8's voice references Day 7's mood, Day 7's open threads, Day 7's calendar churn. LangGraph encodes this as a 35-node subgraph with the edges enforcing order.

**Stage 8 no longer forks.** With DB-backed artifacts, Stage 8B (the old deterministic calendar replay) is absorbed into the calendar service emulator and is no longer a pipeline step. Stage 8A is the single Stage-8 node — a batched agent per persona that INSERTs into `emails` and `notes`. The `.ics` representation is generated on the fly by the calendar emulator from `initial_calendar_events` + `calendar_ops` rows.

**Stage 9 has its own internal fan-out and join.** 9a spawns one validation agent per active declared moment — typically 80–150 agents per persona, all answering the same narrow question against different inputs. Once every `validation_log` row exists, 9b runs a single SQL query joining `declared_moments` with the lifecycle-resolved noise effects and the validation log, partitioned by morning, and writes the 30 JSON files.

## Where each kind of work happens

- **Identity** is set at Stage 0 — the slug, name, prompt text, and seed. Used for filenames downstream.
- **Psychology** is authored at Stage 1 — life context, character sketch, judgment essay. The inversion (sketch first, profile derived) is what produces the front-stage / back-stage gap.
- **Relationships** are authored at Stage 2 — the cast with full P0–P1 interiority, brief P2, and stub P3–P4. Each tier matters because the digest treats them differently.
- **Texture** is authored at Stages 3–4 — day archetypes (what a normal/crisis/recovery day looks like) and channels (which medium carries which conversations).
- **Plot** is authored at Stage 5 — every storyline arc, every declared moment, every noise event. This is the heaviest stage. Nothing downstream invents plot.
- **Calendar seed** is authored at Stage 6 — recurring events, board meetings, offsites, anniversaries pre-existing at Day 1, 00:00 PT.
- **Voice and interiority** are authored at Stage 7 — each day's persona-voice renderings of pre-declared artifacts, journal entries, calendar ops.
- **Artifacts** are materialized at Stage 8 — 8A writes the email/notes bodies the digest reads; 8B replays calendar ops into final `.ics` plus per-day snapshots.
- **Eval ground truth** is materialized at Stage 9 — 9a validates every active moment against the persona's now-known past; 9b walks plans + log to emit ideal digests.

## Why this many stages

Each stage corresponds to a distinct cognitive task that needs its own focused prompt and outputs. Collapsing stages costs in two ways:

- **Long input + long output in the same call** pushes past single-completion quality. The agent-loop architecture handles long inputs by paginated read; the stage boundaries handle long outputs by writing intermediate documents to disk.
- **Conceptual coupling** in the prompt invites drift. A prompt that says "produce the cast and the storylines" will under-author one of them. A prompt that says "produce the storylines, given this cast" produces both, cleanly.

The ten-stage count is empirical: each boundary survives the test "does collapsing this with its neighbor make a noticeably better output?" None do.

## Where the LLM doesn't run

Two places. Both are deliberate.

- **Calendar replay** is pure SQL + Python. `initial_calendar_events` + `calendar_ops` → `.ics` rendered on demand by the calendar service emulator. Deterministic, instant, no LLM. (No longer a pipeline step; the emulator computes it on each query.)
- **Stage 9b (assembly)** is a single SQL query joining `declared_moments` ⋈ `noise_effects` ⋈ `validation_log`. No per-morning LLM. The classic verification-is-easier-than-generation insight: 9a does the substantive checking; 9b just emits.

The optional exception inside 9b is `morning_NN.reasoning.md` — a thin LLM narration call per morning that explains in prose which moments surfaced and why. Useful for human inspection. The structured JSON is fully deterministic regardless.

## What gets read at each boundary

By the time Stage 7 runs:

- `character_sketch.md`, `judgment.md`, `life_context.md` — psychological depth, persona voice
- `cast.md` (prose) + `cast` table (IDs / tiers) — who matters and how
- `day_archetypes.md`, `channels.md` — texture
- `storylines/*/arc.md` (prose) + `declared_moments` / `noise_events` / `planned_artifacts` rows for today — the plot to render today
- `window_plan.md` + cumulative `calendar_ops` rows — calendar history
- `daily_state/day_(N-1).md` — yesterday's accumulated state

By the time Stage 9a runs, on top of all that:

- All artifacts visible by end-of-day-(M-1) — `emails` / `notes` rows with `date_iso ≤ end-of-day-(M-1)`, and the calendar state at that timestamp (replay of `calendar_ops` rows up to that point against `initial_calendar_events`), all served by the service emulator
- `daily_state/day_(M-1).md`

Prompt caching keeps token cost bounded — the foundation docs (`character_sketch.md`, `judgment.md`, `cast.md`, etc.) are cached across the 35 day-of-Stage-7 calls and across the ~80–150 Stage-9a calls. Empirical cache hit rate target: ≥ 80% on Stage 7.
