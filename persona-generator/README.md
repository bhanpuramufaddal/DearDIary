# persona-generator

Generates lived-in synthetic data for arbitrary knowledge-worker personas across a 35-day window. Output is both digest input and eval ground truth.

## What it produces

Per persona, under `data/personas/<slug>/`:

- **`persona.db`** — SQLite. Storylines · declared moments · planned artifacts · noise events · emails · email_attachments · notes · calendar_ops · initial_calendar_events · validation_log · plus observability tables (agent_runs, agent_tool_calls, llm_calls).
- **`profile.md`** — the front-stage compression a digest agent reads.
- **`activity_log.md`** — 35-day diary spine, persona voice.
- **`internal/`** — back-stage reasoning: `persona_origin.md`, `life_context.md`, `character_sketch.md`, `judgment.md`, `cast.md`, `day_archetypes.md`, `channels.md`, `window_plan.md`, `storylines_index.md`, per-storyline `storylines/<id>/arc.md`, and 35 `daily_state/day_NN.md` files.
- **`ideal_digests/morning_NN.json`** — the per-morning eval ground truth (30 files, Days 6–35). Each file lists which moments should surface, their priority/section/action_class, full lifecycle history, and expected suppressions for decoys.

## Pipeline

14 stages orchestrated by LangGraph with SqliteSaver checkpointing. Each stage is an agent loop using `claude-agent-sdk`. Mix of Opus 4.7 (authoring) and Haiku 4.5 (rendering + validation).

| Stage | Purpose | Model | Output |
|---|---|---|---|
| 0 | Spec seed — derive slug, seed_hex, window dates | Opus | `persona_origin.md` + `persona` row + `personas/<slug>.yaml` |
| 1a | Life context — six-domain narrative | Opus | `internal/life_context.md` |
| 1b | Character sketch — backstage truth | Opus | `internal/character_sketch.md` |
| 1c | Judgment essay — how the persona triages attention | Opus | `internal/judgment.md` |
| 1d | Profile — front-stage compression | Opus | `profile.md` |
| 2 | Cast — every named person in orbit | Opus | `internal/cast.md` + `cast` table |
| 3 | Day archetypes — what a normal/crisis/recovery day looks like | Opus | `internal/day_archetypes.md` |
| 4 | Channels — which medium carries which conversation | Opus | `internal/channels.md` |
| 5a | Storyline index — 5–10 storylines + `background_noise` | Opus | `storylines_index.md` + `storylines` rows |
| 5b | Per-storyline detail (× N sub-agents) — arc.md + planned_artifacts + declared_moments + within-storyline noise | Opus | `storylines/<id>/arc.md` + DB rows |
| 5c | Cross-storyline coordination — cross-arc noise + decoys | Opus | More `noise_events` + `planned_artifacts` |
| 6 | Window plan — 5-week narrative outline + initial_calendar_events | Opus | `window_plan.md` + DB rows |
| 7 | Living the day (× 35) — render emails/notes/calendar ops | Haiku | `emails`, `notes`, `calendar_ops`, `daily_state/day_NN.md`, `activity_log.md` |
| 8 | Artifact emission — gap-fill anything Stage 7 missed | Haiku | More `emails` / `notes` |
| 9a | Validation (× ~90 parallel-per-moment) — pass / correct / fail | Haiku | `validation_log` rows |
| 9b | Assembly — deterministic SQL walk, no LLM | (deterministic) | `ideal_digests/morning_NN.json` × 30 |

Density and discipline are taught through **few-shot examples in the committed prompts** (no regex over generated prose). Idempotency at the stage + sub-stage + day level means resume from kill is one command.

## Install + run

```bash
cd persona-generator
uv sync

export ANTHROPIC_API_KEY=sk-...

# Seed Stage 0 (creates personas/<slug>.yaml + persona.db with one row)
uv run persona-gen new "Avery Chen is the founder/CEO of a 12-person seed-stage B2B SaaS company in Oakland..."

# Run the full pipeline (resumable; 0-4 short-circuit on re-run)
uv run persona-gen generate run avery_chen

# Inspect
uv run persona-gen inspect avery_chen --table emails --limit 20
```

`persona-gen generate run <slug>` walks the LangGraph end-to-end and short-circuits any completed stage on resume. Wall-clock: ~2.5–3 hours for a fresh persona.

## Key files

- `src/persona_generator/graph.py` — LangGraph wiring (the 14-node graph)
- `src/persona_generator/pipeline.py` — Typer CLI (`new`, `generate run`, `generate all`, `inspect`)
- `src/persona_generator/agent_runtime.py` — claude-agent-sdk wrapper; single `MAX_TURNS_DEFAULT = 1000` cap
- `src/persona_generator/models.py` — SQLModel schema (one file per persona at `data/personas/<slug>/persona.db`)
- `src/persona_generator/db.py` — `data_root()` + `engine_for(slug)`; `PERSONA_DATA_ROOT` env override available
- `src/persona_generator/stages/stage_*.py` — one module per stage
- `src/persona_generator/prompts/stage_*.md` — committed system + user prompts (each has a `## User prompt template` section the orchestrator renders)
- `src/persona_generator/tools/` — structured tools (`storyline.py`, `cast.py`, `artifact_emit.py`, `email_attachment.py`, `calendar_seed.py`, `validation.py`, `persona_spec.py`)
- `src/persona_generator/artifact_time.py` — synthetic-timestamp backfill (`target_render_iso` reconciliation)

## Design docs

11 markdown files under [`design/`](design/) — start with [`00-overview.md`](design/00-overview.md). Per-stage spec in [`07-stage-details.md`](design/07-stage-details.md); SQL schema in [`10-storage.md`](design/10-storage.md); validation + assembly contract in [`08-validation-and-assembly.md`](design/08-validation-and-assembly.md).

## Tests

```bash
uv run pytest tests/unit/ -q       # ~78 tests, no LLM calls; <2 sec
uv run pytest tests/integration/   # integration / e2e markers
```

## Status

✓ All 14 stages implemented and running end-to-end. Avery Chen reference dataset committed at `data/personas/avery_chen/`. Vikram Mehta / Dana Levin / Aisha Williams reference personas pending.
