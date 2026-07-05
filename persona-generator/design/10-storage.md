# Storage layer (SQLite-backed)

The pipeline produces two very different kinds of output: **long-form prose** authored by agents (life context, character sketch, judgment essay, daily journal entries, storyline arc narrative) and **structured records** with repeatable schema (declared digest moments, noise events, planned artifacts, emails, calendar ops, validation outcomes). Treating them the same way is what makes earlier iterations awkward — prose forced into JSON schemas loses depth, and structured records spread across many small JSON files makes querying painful.

Split them by the right tool:

- **Prose → files on disk** (markdown). Agents read them with paginated `Read`, and humans inspect them with `cat`.
- **Structured records → SQLite tables.** A single file per persona at `data/personas/<slug>/persona.db`.

The criterion for "this earns a SQL table": **the data has a repeatable schema across many rows, and the pipeline (or the eval) queries across those rows** (by date range, lifecycle state, storyline, validation status, etc.). Anything that's a single document, or whose value is the prose itself, stays in a file.

## What goes where

### SQL tables (structured, multi-row, queried)

| Table | Rows / persona | What it is |
|---|---|---|
| `personas` | 1 | Identity, prompt text, seed, window dates |
| `cast` | 10–30 | Cast id, display name, signal tier, role brief |
| `storylines` | 5–10 | Storyline id, display name, path to `arc.md` |
| `declared_moments` | 80–150 | Pre-authored digest items (target morning, section, priority, rationale) |
| `moment_supporting_artifacts` | 200–500 | M:N link between moments and the artifacts that support them |
| `noise_events` | 15–40 | Authored disruptions (occurrence_date, triggers_artifact) |
| `noise_effects` | 50–150 | Per-noise effects with `effective_from` (SHIFTED / CANCELED / MODIFIED / DECLARED) |
| `planned_artifacts` | 200–500 | Every artifact a storyline will produce (artifact_id, render_date, kind, is_decoy) |
| `emails` | 300–1500 | RFC 822 fields + body in TEXT + X-Synth-* extracts |
| `email_attachments` | 0–200 | Attachment binaries; fetched by attachment_id |
| `email_threads` | 50–300 | Materialized threading (root message_id + thread_id) |
| `notes` | 30–100 | Filename, title, body, created/updated ts, X-Synth-* extracts |
| `initial_calendar_events` | 20–50 | Seed events at Day 1, 00:00 (recurring rules) |
| `calendar_ops` | 100–400 | Chronological op log (add/move/cancel/decline) |
| `validation_log` | 80–150 | Stage 9a outcomes: pass / fail / correct + justification |
| `agent_runs` | ~80 | One row per stage invocation (started_at, finished_at, success) |
| `agent_tool_calls` | thousands | Every tool call: stage, ts, tool name, args, result summary |
| `llm_calls` | thousands | Tokens, latency, cache hits per LLM call |
| `broadcast_log` (later, when service emulator ships) | matches event count | Per-event delivery status, retry count, response code |

### Files on disk (prose, single-document, agent-read)

- `profile.md` — front-stage compression
- `internal/persona_origin.md`
- `internal/life_context.md`
- `internal/character_sketch.md` (2–4K words)
- `internal/judgment.md` (essay)
- `internal/cast.md` (prose profiles per cast member; the structured ID/tier list goes to the `cast` table)
- `internal/day_archetypes.md`
- `internal/channels.md`
- `internal/window_plan.md`
- `internal/storylines/<id>/arc.md` (just the narrative arc text; declared moments / noise events / planned artifacts move to SQL)
- `internal/daily_state/day_NN.md` (35 journal entries, persona voice)
- `activity_log.md` (35-day spine)
- `ideal_digests/morning_NN.json` (eval ground truth — kept as JSON files because that's the consumer-facing eval contract)

## The interesting consequence: artifacts cease to exist as files

Today's `artifacts/inbox/*.eml`, `artifacts/notes/*.md`, `artifacts/calendar.ics`, and `graph/calendar_snapshots/*.ics` **all disappear from disk.** They become SQL rows. The service emulator (mail / calendar / notes) generates `.eml` and `.ics` content **on the fly from DB rows** when a consumer requests them via REST or MCP.

This buys:
- **Single source of truth.** No file ↔ DB sync drift.
- **Queryability.** "All P0 emails from cast tier P0 in week 3" is a SQL one-liner instead of a script that opens hundreds of `.eml` files.
- **Faster service emulator.** Mail-service responding to `GET /messages?from=...&after=...` is one indexed query.
- **Stage 8B disappears as a separate step.** The deterministic calendar replay used to materialize `calendar.ics` + 35 snapshot files. With DB-backed ops, the calendar service emulator computes any requested snapshot by replaying ops up to a given date — a few-millisecond query, not a pre-computation step. (Replay logic moves into the calendar service emulator; the pipeline doesn't pre-materialize.)

## Where the DB file lives

```
data/personas/<slug>/
├── persona.db                     ← SQLite, the structured spine
├── profile.md                     ← prose (digest reads)
├── activity_log.md                ← prose (35-day journal)
├── internal/
│   ├── persona_origin.md
│   ├── life_context.md
│   ├── character_sketch.md
│   ├── judgment.md
│   ├── cast.md
│   ├── day_archetypes.md
│   ├── channels.md
│   ├── window_plan.md
│   ├── storylines/<id>/arc.md     ← narrative arc only
│   └── daily_state/day_NN.md      ← 35 journal entries
├── ideal_digests/morning_NN.json  ← eval ground truth (30 files)
└── .langgraph_checkpoint.db       ← separate; pipeline orchestration state
```

One SQLite file per persona keeps isolation simple — `rm -rf data/personas/<slug>/` deletes a persona cleanly. The LangGraph checkpoint DB stays separate (different lifecycle: pipeline run state, not domain data).

## Schema (key tables)

```sql
-- ------------------------------------------------------------
-- Core identity
-- ------------------------------------------------------------
CREATE TABLE personas (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    seed_hex TEXT NOT NULL,
    window_start_date TEXT NOT NULL,
    window_end_date TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Storyline-first authoring (Stage 5)
-- ------------------------------------------------------------
CREATE TABLE storylines (
    storyline_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    arc_path TEXT NOT NULL                  -- → internal/storylines/<id>/arc.md
);

CREATE TABLE declared_moments (
    moment_id TEXT PRIMARY KEY,
    storyline_id TEXT NOT NULL REFERENCES storylines(storyline_id),
    target_morning TEXT NOT NULL,
    section TEXT NOT NULL,                  -- if_one_thing | urgent_todo | …
    priority TEXT NOT NULL,                 -- P0 | P1 | P2
    action_class TEXT NOT NULL,
    rationale TEXT NOT NULL,
    initial_lifecycle TEXT NOT NULL DEFAULT 'DECLARED'
);
CREATE INDEX idx_moments_target ON declared_moments(target_morning);
CREATE INDEX idx_moments_storyline ON declared_moments(storyline_id);

CREATE TABLE moment_supporting_artifacts (
    moment_id TEXT NOT NULL REFERENCES declared_moments(moment_id),
    artifact_id TEXT NOT NULL,
    PRIMARY KEY (moment_id, artifact_id)
);

CREATE TABLE noise_events (
    noise_id TEXT PRIMARY KEY,
    storyline_id TEXT NOT NULL REFERENCES storylines(storyline_id),
    occurrence_date TEXT NOT NULL,
    triggers_artifact_id TEXT
);

CREATE TABLE noise_effects (
    effect_id INTEGER PRIMARY KEY AUTOINCREMENT,
    noise_id TEXT NOT NULL REFERENCES noise_events(noise_id),
    target_moment_id TEXT NOT NULL REFERENCES declared_moments(moment_id),
    effect_kind TEXT NOT NULL,              -- SHIFTED | CANCELED | MODIFIED | DECLARED
    effective_from TEXT NOT NULL,
    new_target_morning TEXT,
    new_rationale TEXT,
    new_priority TEXT
);
CREATE INDEX idx_effects_target ON noise_effects(target_moment_id);
CREATE INDEX idx_effects_effective ON noise_effects(effective_from);

CREATE TABLE planned_artifacts (
    artifact_id TEXT PRIMARY KEY,
    storyline_id TEXT NOT NULL REFERENCES storylines(storyline_id),
    target_render_date TEXT NOT NULL,
    kind TEXT NOT NULL,                     -- email | note | calendar_invite | calendar_update
    content_sketch TEXT,
    is_decoy INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_planned_date ON planned_artifacts(target_render_date);

-- ------------------------------------------------------------
-- Artifacts (rendered at Stage 7/8; service emulator serves these)
-- ------------------------------------------------------------
CREATE TABLE emails (
    message_id TEXT PRIMARY KEY,
    artifact_id TEXT REFERENCES planned_artifacts(artifact_id),
    thread_id TEXT,
    from_addr TEXT NOT NULL,
    to_addrs_json TEXT NOT NULL,            -- JSON array of strings
    cc_addrs_json TEXT,
    subject TEXT NOT NULL,
    date_iso TEXT NOT NULL,
    in_reply_to TEXT,
    body TEXT NOT NULL,
    x_synth_storyline TEXT,
    x_synth_moment_id TEXT,
    x_synth_tonal_zone TEXT,
    x_synth_decoy INTEGER DEFAULT 0,
    x_synth_source_plan TEXT,
    x_synth_calendar_op_id TEXT
);
CREATE INDEX idx_emails_date ON emails(date_iso);
CREATE INDEX idx_emails_thread ON emails(thread_id);
CREATE INDEX idx_emails_storyline ON emails(x_synth_storyline);

CREATE TABLE email_attachments (
    attachment_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES emails(message_id),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    content BLOB NOT NULL
);

CREATE TABLE email_threads (
    thread_id TEXT PRIMARY KEY,
    root_message_id TEXT NOT NULL REFERENCES emails(message_id),
    subject TEXT NOT NULL
);

CREATE TABLE notes (
    note_id TEXT PRIMARY KEY,
    artifact_id TEXT REFERENCES planned_artifacts(artifact_id),
    filename TEXT NOT NULL UNIQUE,
    title TEXT,
    body TEXT NOT NULL,
    created_iso TEXT NOT NULL,
    updated_iso TEXT,
    x_synth_storyline TEXT,
    x_synth_moment_id TEXT,
    x_synth_tonal_zone TEXT,
    x_synth_source_plan TEXT
);
CREATE INDEX idx_notes_created ON notes(created_iso);

-- ------------------------------------------------------------
-- Calendar
-- ------------------------------------------------------------
CREATE TABLE initial_calendar_events (
    event_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    start_iso TEXT NOT NULL,
    end_iso TEXT NOT NULL,
    attendees_json TEXT,
    recurring_rrule TEXT,
    calendar_id TEXT NOT NULL DEFAULT 'primary'
);

CREATE TABLE calendar_ops (
    op_id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_iso TEXT NOT NULL,
    op TEXT NOT NULL,                       -- add_event | move_event | cancel_event | accept_invite | decline_invite | tentative_invite | update_event
    event_id TEXT NOT NULL,
    source TEXT NOT NULL,                   -- direct | email
    linked_message_id TEXT REFERENCES emails(message_id),
    payload_json TEXT NOT NULL
);
CREATE INDEX idx_ops_ts ON calendar_ops(ts_iso);
CREATE INDEX idx_ops_event ON calendar_ops(event_id);

-- ------------------------------------------------------------
-- Cast (structured side of cast.md prose)
-- ------------------------------------------------------------
CREATE TABLE cast (
    cast_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    signal_tier TEXT NOT NULL,              -- p0 | p1 | p2 | p3 | p4
    role_brief TEXT
);

-- ------------------------------------------------------------
-- Eval scaffolding
-- ------------------------------------------------------------
CREATE TABLE validation_log (
    moment_id TEXT PRIMARY KEY REFERENCES declared_moments(moment_id),
    status TEXT NOT NULL,                   -- pass | fail | correct
    justification TEXT NOT NULL,
    reason TEXT,
    severity TEXT,
    corrected_rationale TEXT,
    corrected_priority TEXT,
    validated_at TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Observability
-- ------------------------------------------------------------
CREATE TABLE agent_runs (
    run_id TEXT PRIMARY KEY,
    stage_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    success INTEGER,
    error TEXT
);

CREATE TABLE agent_tool_calls (
    turn_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
    ts_iso TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args_json TEXT,
    result_summary TEXT
);

CREATE TABLE llm_calls (
    call_id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES agent_runs(run_id),
    ts_iso TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    latency_ms INTEGER,
    success INTEGER
);
```

## ORM: SQLModel

Use **SQLModel** (Pydantic + SQLAlchemy 2.0). One class per table, double-purpose: it's the SQLAlchemy ORM model AND the pydantic schema the agent's structured tool already needs. The `emit_email(...)` tool's argument schema and the `emails` row schema are the same object; no drift.

Example:

```python
from sqlmodel import SQLModel, Field
from typing import Optional

class Email(SQLModel, table=True):
    __tablename__ = "emails"
    message_id: str = Field(primary_key=True)
    artifact_id: Optional[str] = Field(default=None, foreign_key="planned_artifacts.artifact_id")
    thread_id: Optional[str] = None
    from_addr: str
    to_addrs_json: str
    cc_addrs_json: Optional[str] = None
    subject: str
    date_iso: str
    in_reply_to: Optional[str] = None
    body: str
    x_synth_storyline: Optional[str] = None
    x_synth_moment_id: Optional[str] = None
    x_synth_tonal_zone: Optional[str] = None
    x_synth_decoy: int = 0
    x_synth_source_plan: Optional[str] = None
    x_synth_calendar_op_id: Optional[str] = None
```

The `emit_email` tool implementation becomes:

```python
def emit_email(session: Session, **kwargs) -> str:
    email = Email(**kwargs)
    session.add(email)
    session.commit()
    return email.message_id
```

That's the entire tool body. Schema validation happens via pydantic on construction; SQLAlchemy handles the insert; the agent sees a typed function it calls with kwargs.

## How this changes the pipeline

| Stage | Old (files) | New (DB) |
|---|---|---|
| Stage 5 — Storylines + plans | `declare_digest_moment` etc. append to `plan.md` | Same tools, but INSERT into `declared_moments`, `noise_events`, `noise_effects`, `planned_artifacts`. `arc.md` is just the narrative arc prose. |
| Stage 6 — Window Plan | `add_initial_calendar_event` appends to `initial_calendar.json` | INSERT into `initial_calendar_events` |
| Stage 7 — Living the Day | `emit_email` / `write_note` / `add_calendar_op` write files | Same tools, INSERT into `emails` / `notes` / `calendar_ops` |
| Stage 8A — Artifact Emission | Renders pre-declared artifacts into `.eml` / `.md` files | INSERT rows into `emails` / `notes`. No files written. |
| Stage 8B — Calendar Replay | Deterministic Python writes `calendar.ics` + 35 snapshot files | **Gone.** Calendar replay moves into the calendar service emulator, computed on demand from `initial_calendar_events` + `calendar_ops`. |
| Stage 9a — Validation | `validation_pass/fail/correct` append to `validation_log.jsonl` | INSERT into `validation_log` |
| Stage 9b — Assembly | Deterministic walk over `plan.md` files + `validation_log.jsonl` | One SQL query joining `declared_moments` ⋈ `noise_effects` ⋈ `validation_log`. Writes `ideal_digests/morning_NN.json` (kept as files). |

## What `agent_runtime.py` verifies after each stage

The "post-run file-existence check" generalizes to "post-run output check" — depending on the stage, this is now a DB query or a file check:

- **Prose-output stages** (1a, 1b, 1c, 1d, 2-cast.md, 3, 4, 5-arc.md, 6-window_plan.md, 7-daily_state, activity_log): file exists on disk, non-empty.
- **Structured-output stages** (5-moments/noise/artifacts, 6-initial_calendar, 7-emails/notes/calendar_ops, 8, 9a): expected DB rows exist (`SELECT COUNT(*) FROM emails WHERE date_iso LIKE 'YYYY-MM-DD%'` etc.).
- **Hybrid stages** (5, 7): check both file and DB.

Mismatches trigger one retry, then escalate per the existing conditional-edges logic in `02-orchestration.md`.

## Migrations and schema evolution

For now: ship a single canonical schema at v1. When it changes, write a one-shot migration script (`scripts/migrate_v1_to_v2.py`) that walks every `data/personas/<slug>/persona.db` and applies the diff. No need for Alembic at this scale; we have ≤5 personas in eval and 1 schema author.

## Inspection / debugging

- `sqlite3 data/personas/avery_chen/persona.db` for ad-hoc queries
- Optional: a thin CLI `person-gen inspect <slug> --table emails --limit 20`
- The service emulator (when it ships) exposes the same data via REST + MCP, so the digest-agent never touches `persona.db` directly — it goes through the emulator's API surface, which keeps the production-shape interface honest.

## What this does NOT change

- The reasoning-first principle. Prose still lives in markdown; the schema only captures things that were already structured.
- The agent loop architecture. Agents still call typed tools; the tools' implementations just point at SQL instead of disk.
- The Stage 5 storyline-first design. Plans are still authored upstream; everything downstream still consumes them. The medium changed; the shape didn't.
