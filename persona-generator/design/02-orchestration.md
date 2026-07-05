# Orchestration — LangGraph

How the ten stages are wired together: graph topology, shared state, subgraphs, conditional edges, and SQLite checkpointing.

The pipeline has natural graph structure: sequential foundation stages with hard dependencies, parallel branches after Stage 7, an internal sequential cascade inside Stage 7 (35 days with day-to-day state propagation), an internal parallel fan-out inside Stage 9 (one validation per moment), and a shared state object that flows through every node. LangGraph is built for this.

## Two-layer architecture

| Layer | Library | Responsibility |
|---|---|---|
| Pipeline orchestration (between stages) | `langgraph` | Graph topology, shared state flow, parallel execution, conditional edges (retries, skip-if-complete), checkpointing for resumability |
| Stage execution (within a stage) | `claude-agent-sdk` | ReAct agent loop with file + structured-output tools |

The two are complementary. LangGraph schedules a node; the node invokes a `claude-agent-sdk` agent; the agent does the work, writes outputs to disk, terminates; LangGraph reads the updated state and routes to the next node.

## Pipeline state

The shared `PipelineState` TypedDict that flows through every node:

```python
class PipelineState(TypedDict, total=False):
    # Identity (set by Stage 0)
    persona_slug: str
    persona_name: str
    prompt_text: str
    working_dir: Path

    # Window
    window_start_date: str   # ISO date — Day 1
    window_end_date: str     # ISO date — Day 35

    # Stage tracking
    completed_stages: list[str]
    stage_outputs: dict[str, list[str]]   # stage_id → output paths

    # Cascade (Stage 7)
    current_day: int
    last_completed_day: int

    # Eval window (Stage 9)
    completed_mornings: list[int]

    # Error handling
    errors: list[dict]                    # {stage, message, retry_count}

    # Logging
    llm_call_log_path: Path
    agent_turn_logs: dict[str, Path]
```

## Top-level graph topology

```
[START]
   ↓
stage_00_spec → stage_01a → stage_01b → stage_01c → stage_01d
   ↓
stage_02_cast → stage_03_archetypes → stage_04_channels
   ↓
stage_05_storylines → stage_06_window_plan
   ↓
┌─────────────────────────────────────┐
│  stage_07_subgraph (LangGraph)      │
│  day_01 → day_02 → ... → day_35     │   35 sequential nodes, rendering only
└─────────────────┬───────────────────┘
                  ↓
            stage_08a                              (batched agent per persona;
            (Artifact Emission)                     INSERTs into emails / notes tables)
                  ↓
  ┌─────────────────────────────────────────┐
  │  stage_09_subgraph  ·  Ideal Digest     │
  │  ─────────────────────────────────────  │
  │  9a Validation (parallel-per-moment)    │   ~80–150 LLM agents per persona
  │  spawns one agent per active moment;    │   answer ONE narrow question each;
  │  outcomes INSERT into validation_log    │   join when all moments done
  │              ↓                          │
  │  9b Assembly (single SQL query)         │   joins declared_moments ⋈
  │  joins moments / effects / validation   │   noise_effects ⋈ validation_log;
  │  log; writes 30 morning_NN.json files   │   no LLM
  └───────────────────┬─────────────────────┘
                      ↓
                    [END]
```

**Stage 8B is gone.** What was a separate deterministic-Python calendar-replay step now lives inside the calendar service emulator and runs on demand from `calendar_ops` rows. The pipeline doesn't pre-materialize calendar snapshots.

## Subgraphs

**`stage_07_subgraph`** — 35 sequential `day_NN` nodes. Each day's node reads pre-declared events for today from the `declared_moments` / `planned_artifacts` / `noise_events` tables (Stage 5 authored them there), renders them via `emit_email` / `write_note` / `add_calendar_op` which INSERT rows into `emails` / `notes` / `calendar_ops`, writes daily_state and activity_log entries to markdown files in persona voice, updates `last_completed_day`. The cascade is encoded in the edges. **Stage 7 has no plot authority; it cannot author new noise events or modify declared moments.** See [storyline authoring](04-storyline-authoring.md).

**`stage_09_subgraph`** — Stage 9's two internal phases form one subgraph:

- **9a Validation** — parallel-per-moment fan-out. One LLM agent per declared moment whose final state (after applying all lifecycle effects with `effective_from ≤ target_morning`) is `DECLARED` and whose `target_morning` falls in the eval window. Moments are independent; LangGraph fans them out in parallel. Each agent reads the persona's actual past as of morning M (all visible artifacts via the service emulator or directly via DB queries scoped to `date_iso ≤ end-of-day-(M-1)`, plus `daily_state/day_(M-1).md`, `character_sketch.md`, `judgment.md`) and emits exactly one of `validation_pass`, `validation_fail`, or `validation_correct` — each INSERTs a row into `validation_log`.
- **9b Assembly** — no LLM, no per-morning walk in Python. One SQL query joins `declared_moments` ⋈ `noise_effects` (applying `effective_from ≤ M` lifecycle resolution) ⋈ `validation_log`, grouped by morning. The result writes 30 `ideal_digests/morning_NN.json` files.
- The two phases are sequential within the subgraph: 9a's `validation_log` rows must all exist before 9b can run its query.

See [08-validation-and-assembly.md](08-validation-and-assembly.md) for the substance of what each phase does.

## Conditional edges

- **Retry on missing outputs.** Every stage node has `→ retry | → next` conditional. After each agent terminates, `agent_runtime` verifies expected outputs exist — markdown files on disk for prose stages (1a–1d, 2-cast.md prose, 3, 4, 5-arc.md, 6-window_plan.md, 7-daily_state, activity_log), expected rows in `persona.db` for structured-output stages (5-moments/noise/artifacts, 6-initial_calendar, 7-emails/notes/calendar_ops, 8A, 9a). If anything's missing, retry once; on second failure, append to `state.errors` and either skip downstream (non-blocking) or terminate. See [10-storage.md](10-storage.md) for the per-stage verification matrix.
- **Skip-if-complete.** `--from-stage N` and `--resume` route through a "load checkpoint" entry that fast-forwards `completed_stages` and jumps to the first incomplete stage.
- **Idempotency at Stage 0.** If `personas/<slug>.yaml` exists, the node marks complete in state without invoking the agent.

## Checkpointing for resumability

LangGraph's SQLite checkpointer persists `PipelineState` after every node. One checkpoint DB per persona at `data/<slug>/.langgraph_checkpoint.db`. Effects:

- `persona-gen generate <slug> --from-stage N` loads checkpoint, jumps to stage N.
- Mid-cascade death recovery: if the run dies on Day 17 of Stage 7, the next invocation re-enters the subgraph at Day 17. Prior days don't re-run.
- Re-running a fully-completed persona is a no-op — every node sees its stage already in `completed_stages` and skips.

## Files this layer adds

- `src/persona_generator/state.py` — `PipelineState` TypedDict and helpers.
- `src/persona_generator/graph.py` — builds the top-level `StateGraph`, registers nodes, declares edges, configures checkpointer. Exposes `build_pipeline()`.
- `src/persona_generator/subgraphs/stage_07_cascade.py` — 35-day sequential subgraph builder (rendering only).
- `src/persona_generator/subgraphs/stage_09_ideal_digest.py` — Stage 9's two-phase subgraph builder (9a parallel-per-moment validation + 9b deterministic walk assembly).
- `src/persona_generator/lifecycle.py` — pure lifecycle state-machine functions used by both Stage 9 phases (9a to filter active moments; 9b to walk the cascade).
- `pyproject.toml` gains `langgraph` and `langgraph-checkpoint-sqlite`.
- Existing `src/persona_generator/stages/*.py` become **LangGraph node functions** — each takes `state: PipelineState`, invokes `agent_runtime.run_agent(...)`, returns a partial state update.
- `pipeline.py` becomes thin — parses args, sets up checkpointer, calls `build_pipeline().invoke(initial_state)`.

See `diagrams/langgraph-orchestration.excalidraw` for the visual.
