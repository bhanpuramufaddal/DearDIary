# Backend Architecture

This doc specifies the actual backend: the framework that hosts the daemon, the storage layer that holds the cognitive substrate, the event bus that wires subsystems together, the process model that runs the agent loops, the surfaces that face the principal, and the boundaries between them.

Earlier docs (`00`–`10`) describe *what* the digest agent does. This doc describes *how it runs*.

## Stack

| Concern | Pick |
|---|---|
| Host runtime | Electron 30+ (Node.js main process; renderer for the diary window and inspector) |
| Language | TypeScript (strict, ESM, target ES2022) |
| Database | SQLite via `better-sqlite3` (synchronous, WAL mode) |
| Migrations | `@blackglory/better-sqlite3-migrations` (uses `PRAGMA user_version`) |
| HTTP server | `fastify` (the webhook server) |
| MCP framework | `@modelcontextprotocol/sdk` (we build two MCP servers — substrate + surface) |
| Agent runtime | Claude Code CLI — every agent loop is a subprocess in permissionless mode |
| Tunnel | `ngrok` subprocess (managed by the tunnel manager) |
| Bundler | `esbuild` (compiles TS natively; bundles main + renderer) |
| Diary aesthetic | Native DOM + CSS; static SVG illustrations; no UI framework |

No ORM. No state-management library. No event-bus dependency. No motion library. Each of those is a few hundred lines of code we write ourselves; the alternative is binding the architecture's shape to a library's shape.

## Process model

```
┌────────────────────────────────────────────────────────────────┐
│ Electron main process (Node.js, TypeScript)                    │
│                                                                │
│   Event bus (in-process, typed; src/main/bus.ts)               │
│                                                                │
│   Subsystems:                                                  │
│     • Webhook server (Fastify, loopback-only)                  │
│     • Tunnel manager (supervises ngrok subprocess)             │
│     • Reminder scheduler                                       │
│     • Diary scheduler                                          │
│     • Mind / diary / cold-start / execution dispatchers        │
│     • Substrate MCP servers (3 role-scoped instances)          │
│     • Surface MCP server (for principal's Claude Code)         │
│     • External MCP lifecycle (gmail, gcal, persona-emulator)   │
│     • IPC bridge (to renderer)                                 │
│                                                                │
│   Storage: better-sqlite3 → ~/digest/digest.db (WAL)           │
│                                                                │
│   Subprocesses (spawned + supervised):                         │
│     • ngrok                                                    │
│     • digest-substrate-mcp[mind]   (long-lived)                │
│     • digest-substrate-mcp[diary]  (long-lived)                │
│     • digest-substrate-mcp[cold]   (long-lived)                │
│     • External MCP servers (gmail-mcp, gcal-mcp, …)            │
│     • Claude Code instances (short-lived; one per invocation): │
│         mind agent     — per event                              │
│         diary agent    — per schedule_tick / digest_run         │
│         cold-start     — per profile.md change                  │
│         task executor  — per task.fired                         │
└────────────────────────────────────────────────────────────────┘
            │ IPC (contextBridge)
            ▼
┌────────────────────────────────────────────────────────────────┐
│ Electron renderer process(es)                                  │
│   • Diary view — PRIMARY UI (journal-styled, paper aesthetic)  │
│   • Inspector — anchors/entities/events/thinking_layer browser │
│   • Settings — config.jsonc editor                             │
└────────────────────────────────────────────────────────────────┘
```

### What runs where

| Component | Process | Lifetime |
|---|---|---|
| Event bus | Main (in-process) | Lifetime of app |
| SQLite connection (main's writes for IPC-handled work, schedulers, surface MCP, dispatchers) | Main | Lifetime of app |
| Webhook server | Main (Fastify on loopback) | Lifetime of app |
| Schedulers and dispatchers | Main (async modules on event loop) | Lifetime of app |
| `ngrok` | Subprocess (supervised by tunnel manager) | Lifetime of app |
| External MCP servers | Subprocesses (managed by MCP lifecycle) | Lifetime of app |
| `digest-substrate-mcp[role]` × 3 | Subprocesses (managed by main; stdio MCP) | Lifetime of app |
| `digest-surface-mcp` | Subprocess (stdio MCP) | Lifetime of app |
| Claude Code agent invocations | Subprocesses (one per invocation) | Per-invocation; exit on completion |
| Renderer windows | Renderer process (Electron) | On-demand (tray click) |

### Why every agent loop is a subprocess

Mind, diary, cold-start, and task execution all run as `claude` CLI invocations with `--dangerously-skip-permissions`. The main process never runs an LLM loop directly.

This shape unifies the cognitive runtime: every reasoning act in the system is a Claude Code instance with MCP tool access. The only difference between roles is which system prompt is loaded and which MCP servers are exposed. The agent allowlists defined in `03a-agent-shape.md` become MCP server scoping decisions: each role's Claude Code launch points at a substrate MCP server that has registered only that role's allowed tools.

The cost is subprocess spawn overhead (~100–300ms per invocation). The benefits: process isolation between agent runs; consistent permission posture; observable via standard process and MCP-protocol traces; no SDK version churn.

## Storage layer (SQLite, graph-respecting)

One file: `~/digest/digest.db`. WAL mode for concurrent reads while writes are in progress (the substrate MCP server subprocesses and the main process both hold connections). Migrations apply at boot, before any subsystem starts.

The cognitive substrate is a graph. Anchors and entities are nodes; relationships are directed edges; predictions are anchor-bound facts; case base entries are citations from a node's layer to a source. The schema represents each of these as a proper table — junction tables for many-to-many, foreign keys for one-to-many. JSON columns are reserved for inert content (layer prose, identity-handle arrays, component payloads) — never graph topology.

`PRAGMA foreign_keys = ON` at every connection. `ON DELETE CASCADE` wires cleanup: deleting an anchor row also drops its predictions, layer bindings, case-base entries, and incoming/outgoing relationships.

### Schema (DDL)

```sql
-- The nodes parent table: every anchor and every entity has a nodes row.
-- Relationships and case-base entries FK against nodes so they work uniformly
-- across both kinds.
CREATE TABLE nodes (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('anchor', 'entity')),
  created_at  TEXT NOT NULL
);

CREATE TABLE anchors (
  id                 TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,                -- free-form: person | project | deal | …
  display_name       TEXT,
  activation         REAL NOT NULL DEFAULT 0,
  last_bumped        TEXT NOT NULL,
  identity_handles   TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  slow_content       TEXT,
  slow_precision     REAL,
  mid_content        TEXT,
  mid_precision      REAL,
  fast_content       TEXT,
  fast_precision     REAL,
  notes              TEXT
);
CREATE INDEX idx_anchors_last_bumped ON anchors(last_bumped);

-- Note: `nodes.kind` distinguishes anchor from entity. `anchors.kind` is the
-- agent-visible free-form classifier (person / project / deal / …) per the
-- `Anchor` shape in 01-anchor-model.md. Two distinct concepts that share a name.

CREATE TABLE entities (
  id                 TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  kind_hint          TEXT,                          -- free-form: person / vendor / topic / …
  first_seen         TEXT NOT NULL,
  last_seen          TEXT NOT NULL,
  mention_count      INTEGER NOT NULL DEFAULT 1,
  identity_handles   TEXT NOT NULL DEFAULT '[]',
  notes              TEXT
);
CREATE INDEX idx_entities_last_seen ON entities(last_seen);
CREATE INDEX idx_entities_mention_count ON entities(mention_count);

-- First-class directed edges. target_id FKs against anchors(id) so entities
-- cannot be targets at the FK level. A trigger (below) provides defense in
-- depth with a clear error message.
CREATE TABLE relationships (
  id              TEXT PRIMARY KEY,
  subject_id      TEXT NOT NULL REFERENCES nodes(id)   ON DELETE CASCADE,
  target_id       TEXT NOT NULL REFERENCES anchors(id) ON DELETE CASCADE,
  slow_claim      TEXT,
  slow_precision  REAL,
  mid_claim       TEXT,
  mid_precision   REAL,
  fast_claim      TEXT,
  fast_precision  REAL,
  UNIQUE (subject_id, target_id)
);
CREATE INDEX idx_relationships_subject ON relationships(subject_id);
CREATE INDEX idx_relationships_target  ON relationships(target_id);

-- Anchor-bound facts. Entities don't predict.
-- expected_by is required for kind='event' and forbidden otherwise (CHECK).
CREATE TABLE predictions (
  id                   TEXT PRIMARY KEY,
  anchor_id            TEXT NOT NULL REFERENCES anchors(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL CHECK (kind IN ('event', 'fact', 'pattern')),
  claim                TEXT NOT NULL,
  expected_by          TEXT,
  precision            REAL NOT NULL,
  created_at           TEXT NOT NULL,
  source_dispatchable  TEXT,                       -- diary/<date>#<component_id> for efference copies
  CHECK ((kind = 'event' AND expected_by IS NOT NULL) OR (kind <> 'event' AND expected_by IS NULL))
);
CREATE INDEX idx_predictions_anchor              ON predictions(anchor_id);
CREATE INDEX idx_predictions_expected_by         ON predictions(expected_by);
CREATE INDEX idx_predictions_source_dispatchable ON predictions(source_dispatchable);

-- Junction for prediction.based_on: which anchor layers cascade on support/contradict.
CREATE TABLE prediction_layer_bindings (
  prediction_id  TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  anchor_id      TEXT NOT NULL REFERENCES anchors(id)     ON DELETE CASCADE,
  layer          TEXT NOT NULL CHECK (layer IN ('slow', 'mid', 'fast')),
  PRIMARY KEY (prediction_id, layer)
);

-- Citations. Every case_base_entry is a row.
CREATE TABLE case_base_entries (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  layer       TEXT CHECK (layer IN ('slow', 'mid', 'fast') OR layer IS NULL),
                                                -- layer is NULL for entities (flat case base)
  source_id   TEXT NOT NULL,                    -- e.g. gmail:msg_abc, gcal:event_xyz
  date        TEXT NOT NULL,
  note        TEXT,                             -- agent commentary stamp (optional)
  position    INTEGER NOT NULL DEFAULT 0        -- ordering within (node_id, layer)
);
CREATE INDEX idx_case_base_source ON case_base_entries(source_id);
CREATE INDEX idx_case_base_node   ON case_base_entries(node_id, layer, position);

CREATE TABLE reminders (
  id        TEXT PRIMARY KEY,
  fires_at  TEXT NOT NULL,
  context   TEXT NOT NULL,
  set_by    TEXT NOT NULL CHECK (set_by IN ('mind_agent', 'diary_agent')),
  set_at    TEXT NOT NULL,
  fired_at  TEXT
);
CREATE INDEX idx_reminders_fires_at ON reminders(fires_at) WHERE fired_at IS NULL;

CREATE TABLE reminder_anchor_refs (
  reminder_id  TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  anchor_id    TEXT NOT NULL REFERENCES anchors(id)   ON DELETE CASCADE,
  PRIMARY KEY (reminder_id, anchor_id)
);

-- Diary: one day per row in diary_days; everything else hangs off it.
CREATE TABLE diary_days (
  date TEXT PRIMARY KEY                                    -- YYYY-MM-DD
);

CREATE TABLE diary_components (
  id                       TEXT PRIMARY KEY,
  diary_date               TEXT NOT NULL REFERENCES diary_days(date) ON DELETE CASCADE,
  type                     TEXT NOT NULL,                  -- email-draft | calendar-block | choose-one | free-text-reply | diary-prose | big-number | stat-block | chart | report
  section                  TEXT NOT NULL,                  -- right_now | on_the_desk | tracking | background
  headline                 TEXT,
  rationale                TEXT,
  template_id              TEXT NOT NULL,                  -- which HITL template renders this
  content                  TEXT NOT NULL DEFAULT '{}',     -- type-specific JSON payload
  actions                  TEXT NOT NULL DEFAULT '[]',     -- JSON array of action affordances
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acted', 'closed', 'dismissed')),
  efference_prediction_id  TEXT REFERENCES predictions(id) ON DELETE SET NULL,
  position                 INTEGER NOT NULL DEFAULT 0      -- ordering within (diary_date, section)
);
CREATE INDEX idx_diary_components_day_section ON diary_components(diary_date, section, position);

CREATE TABLE diary_component_anchor_refs (
  component_id  TEXT NOT NULL REFERENCES diary_components(id) ON DELETE CASCADE,
  anchor_id     TEXT NOT NULL REFERENCES anchors(id)          ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (component_id, anchor_id)
);

CREATE TABLE diary_comments (
  id            TEXT PRIMARY KEY,
  component_id  TEXT NOT NULL REFERENCES diary_components(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE diary_notes (
  id          TEXT PRIMARY KEY,
  diary_date  TEXT NOT NULL REFERENCES diary_days(date) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE diary_thinking_entries (
  id          TEXT PRIMARY KEY,
  diary_date  TEXT NOT NULL REFERENCES diary_days(date) ON DELETE CASCADE,
  tick_at     TEXT NOT NULL,
  entries     TEXT NOT NULL DEFAULT '[]'                     -- JSON array of strings
);

-- Bus audit log: every event emitted by the bus lands here.
CREATE TABLE events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,
  payload       TEXT NOT NULL,                              -- JSON
  source_id     TEXT,
  observed_at   TEXT,
  occurred_at   TEXT,
  published_at  TEXT NOT NULL
);
CREATE INDEX idx_events_kind_published ON events(kind, published_at DESC);

-- Cursor tracking for durable bus subscribers.
CREATE TABLE event_subscriber_cursors (
  subscriber_name  TEXT PRIMARY KEY,
  last_event_id    INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL
);
```

### Migrations beyond 001

The block above is migration `001_init`. Later migrations (applied in order at boot via `PRAGMA user_version`) extend it:

- **`002_pending_bus_events`** — a durable spool the out-of-process surface MCP subprocess writes to (it can't touch the in-process bus). The **event relay** drains it and re-emits on the bus. Carries `digest_run` ticks, comments, and notes from the principal's Claude Code into the runtime.
- **`003` / `007`** — `003` added an `agent_tool_calls` instrumentation table; `007_drop_agent_tool_calls` removed it once telemetry moved to Langfuse/OpenTelemetry. Net: no such table in the current schema.
- **`004`** — loosened `diary_components.section` and added artifact columns.
- **`005_plays`** — the plays table (the cognitive precedent library; see [05-plays.md](05-plays.md)):

  ```sql
  CREATE TABLE plays (
    name          TEXT PRIMARY KEY,   -- '{prefix}:{slug}', e.g. 'triage:busy-morning'
    title         TEXT NOT NULL,
    content       TEXT NOT NULL,      -- markdown precedent
    derived_from  TEXT,               -- JSON array of source_ids (persona plays); NULL for house plays
    created_at    TEXT NOT NULL
  );
  ```

  House plays are upserted from `prompts/seed-plays/*.md` at every boot; persona plays are written by the cold-start agent's `create_play`. Read by mind/diary via `run_sql`.
- **`006_subjects_view`** — a read-only `VIEW subjects` unioning anchors + entities into one shape (`id, subject_kind, name, kind, identity_handles, last_active, *_precision, mention_count`). Exists so `run_sql` callers stop hand-JOINing `nodes`/`anchors`/`entities` and stop tripping on `display_name` (anchor-only) vs. slug-as-name (entity). Writes still target the base tables through typed tools.

### Graph queries become cheap

The schema is honest about the graph. Common queries:

- **Edges out of an anchor.** `SELECT target_id FROM relationships WHERE subject_id = ?`
- **Edges into an anchor.** `SELECT subject_id FROM relationships WHERE target_id = ?`
- **All citations of a source.** `SELECT DISTINCT node_id FROM case_base_entries WHERE source_id = ?`
- **Layer's case base in order.** `SELECT * FROM case_base_entries WHERE node_id = ? AND layer = ? ORDER BY position`
- **Components surfacing an anchor today.** `SELECT component_id FROM diary_component_anchor_refs WHERE anchor_id = ? AND component_id IN (SELECT id FROM diary_components WHERE diary_date = ?)`
- **Stale entities (promotion / deletion candidates).** `SELECT id FROM entities WHERE last_seen < ? AND mention_count < ?`

No `json_extract`. No full-table scans. The agent reads the substrate as a graph; the storage layer presents it as one.

### Diary assembly

The diary's contract is a JSON document (see `02-diary-model.md`). The storage layer holds it relationally. Two functions bridge:

- `assembleDiary(date) → DiaryJson` — `SELECT`s from `diary_days`, `diary_components`, `diary_component_anchor_refs`, `diary_comments`, `diary_notes`, `diary_thinking_entries`; composes the JSON shape. Used by the surface MCP server's `digest_get` and by the renderer's diary view.
- `persistDiary(...)` — INSERTs/UPDATEs the rows for a diary write. Backs the diary agent's per-template `write_<template>` component tools.

The relational form is the source of truth; the JSON is reconstructed on read.

## Event bus

The bus lives in `src/main/bus.ts`. Typed subscribe / emit. Hybrid durability — every emit also writes an audit row; durable subscribers track a cursor.

### Event taxonomy

```ts
// shared/types/events.ts (excerpt)

export type BusEvent =
  | { kind: 'webhook.persona';        payload: WebhookEvent }
  | { kind: 'webhook.gmail';          payload: WebhookEvent }
  | { kind: 'webhook.gcal';           payload: WebhookEvent }
  | { kind: 'reminder.fired';         payload: ReminderEvent }
  | { kind: 'schedule.diary_tick';    payload: { trigger_at: string } }
  | { kind: 'profile.changed';        payload: { mtime: string } }
  | { kind: 'diary.comment.added';    payload: CommentEvent }
  | { kind: 'diary.note.added';       payload: NoteEvent }
  | { kind: 'task.fired';             payload: TaskFiredEvent }
  | { kind: 'task.completed';         payload: TaskOutcomeEvent }
  | { kind: 'task.failed';            payload: TaskOutcomeEvent }
  | { kind: 'mind.invocation.done';   payload: InvocationOutcome }
  | { kind: 'diary.invocation.done';  payload: InvocationOutcome }
  | { kind: 'coldstart.invocation.done'; payload: InvocationOutcome }
  | { kind: 'tunnel.up';              payload: { public_url: string } }
  | { kind: 'tunnel.down';            payload: { reason: string } };

export type BusKind = BusEvent['kind'];
export type PayloadOf<K extends BusKind> = Extract<BusEvent, { kind: K }>['payload'];
```

### Bus API

```ts
// src/main/bus.ts

export interface Bus {
  emit<K extends BusKind>(kind: K, payload: PayloadOf<K>): Promise<void>;
  on<K extends BusKind>(
    kind: K,
    handler: (payload: PayloadOf<K>) => Promise<void> | void,
    opts?: { durable?: boolean; name?: string }
  ): void;
  off<K extends BusKind>(kind: K, handler: Handler<K>): void;
}
```

### Hot path

1. `emit(kind, payload)` is called.
2. The bus synchronously INSERTs an `events` row (prepared statement; ~50µs).
3. Subscribers run in registration order. Each handler is awaited before the next handler runs. The depth limit guards against runaway emit-chains.
4. Durable subscribers' cursor advances when their handler resolves successfully.

### Durability

A subscriber registered with `{ durable: true, name: 'mind-dispatcher' }` has its cursor tracked in `event_subscriber_cursors`. On main-process restart, the bus replays unprocessed `events` rows to each durable subscriber from its cursor before accepting fresh emits.

Two consequences:

- The mind dispatcher never loses a webhook event to a crash — on restart, any rows past its cursor are re-delivered.
- The events table accumulates over time; a retention policy (default: 30 days for non-durable, indefinite for durable) trims it via a background sweeper.

## Subsystems

| Subsystem | Module | Publishes | Subscribes to |
|---|---|---|---|
| Bus | `src/main/bus.ts` | — | — |
| Storage | `src/main/db/*` | — | — (shared dependency) |
| Webhook server | `src/main/webhook/server.ts` + `webhook/adapters/*` | `webhook.<source-kind>` | — |
| Tunnel manager | `src/main/webhook/tunnel.ts` | `tunnel.up`, `tunnel.down` | — |
| Reminder scheduler | `src/main/scheduler/reminders.ts` | `reminder.fired` | `mind.invocation.done` (re-checks `reminders` table after each mind tick) |
| Diary scheduler | `src/main/scheduler/diary.ts` | `schedule.diary_tick` | — |
| Profile watcher | `src/main/scheduler/profileWatcher.ts` | `profile.changed` | — |
| Mind dispatcher | `src/main/dispatcher/mind.ts` | `mind.invocation.done` | every cognition trigger (durable, serialized) |
| Diary dispatcher | `src/main/dispatcher/diary.ts` | `diary.invocation.done` | `schedule.diary_tick`, `mind.invocation.done` |
| Cold-start dispatcher | `src/main/dispatcher/coldStart.ts` | `coldstart.invocation.done` | `profile.changed` |
| Execution dispatcher | `src/main/dispatcher/execution.ts` | `task.completed`, `task.failed` | `task.fired` |
| Substrate MCP server (× 3 roles) | `src/main/mcp/substrate/server.ts` (`--role`), tools in `mcp/substrate/tools/*`, allowlist in `catalog.ts` | — | — (called by spawned Claude Code subprocesses) |
| Surface MCP server | `src/main/mcp/surface/server.ts` + `surface/tools.ts` | `diary.comment.added`, `diary.note.added`, `task.fired` (via `pending_bus_events` → event relay) | — (called by principal's Claude Code) |
| Persona service MCPs (test mode) | `src/main/mcp/{personaEmail,personaCalendar,personaNotes}/*` over `_personaServer/buildServer.ts` | — | — (stand in for gmail/gcal/notes MCPs against the persona DB) |
| Claude Code launcher | `src/main/claudeCode.ts` | — | helper module |
| Telemetry | `src/main/telemetry/langfuse.ts` | — | — (OpenTelemetry → Langfuse; no-op unless `LANGFUSE_*` set) |
| Event relay | `src/main/dispatcher/eventRelay.ts` | re-emits rows from `pending_bus_events` | — (drains the surface MCP subprocess's out-of-process writes) |
| IPC bridge | `src/main/ipc.ts` | `task.fired`, `diary.comment.added`, `diary.note.added` (from renderer) | renderer-visible events |

Subsystems communicate via the bus, not by calling each other directly. The storage layer is the sole shared dependency.

## Agent runtime

Each agent invocation is a `claude` subprocess. The dispatcher's job is to assemble the prompt and MCP config, then spawn.

### Launcher contract

```ts
// src/main/claudeCode.ts

export interface ClaudeCodeOptions {
  systemPrompt: string;           // disposition.md + per-agent prompt
  userPrompt: string;             // the event payload or composition goal
  mcpConfig: McpConfigJson;       // path or inline; written to a temp file if needed
  cwd?: string;
  timeoutMs?: number;             // default 5 min for mind, 15 for diary, 30 for execution
}

export interface ClaudeCodeOutcome {
  exitCode: number;
  outcomeJson: unknown | null;    // parsed from stdout's final JSON line if structured-output mode
  stderr: string;
}

export async function invokeClaudeCode(opts: ClaudeCodeOptions): Promise<ClaudeCodeOutcome>;
```

Internally: writes the MCP config to a temp file, spawns `claude --dangerously-skip-permissions --system-prompt @<file> --mcp-config <file>`, pipes the user prompt to stdin, captures stdout/stderr, parses the final structured-output JSON, returns on exit.

### Substrate MCP scoping

One substrate MCP server binary (`src/main/mcp/substrate/server.ts`) is launched once per role — `--role={mind|diary|cold-start}` — and each instance registers exactly its role's allowlist from `src/main/mcp/substrate/catalog.ts` (see `03a-agent-shape.md` for the full tables):

- `digest-substrate-mcp[mind]` — `run_sql` (the single read tool) + the file readers (`read_profile`, `list_playbook_sections`, `read_playbook_section`) + the typed write tools: `create_anchor` / `update_anchor_layer` / `update_anchor_meta` / `bump_anchor` / `delete_anchor`, `create_entity` / `bump_entity` / `update_entity` / `delete_entity` / `promote_entity`, `update_identity_handles`, `cite`, `create_relationship` / `update_relationship_layer` / `delete_relationship`, `create_prediction` / `delete_prediction`, the precision family (`support_*` / `contradict_*` for anchor / relationship / prediction), `set_reminder` / `cancel_reminder`.
- `digest-substrate-mcp[diary]` — `run_sql` + the file readers + the per-template `write_<template>` family + `clear_diary`, `delete_diary_component`, `append_thinking_layer`, `emit_efference_prediction`.
- `digest-substrate-mcp[cold-start]` — the mind allowlist plus `create_play`.

Reads for every role go through `run_sql` against a **read-only** SQLite connection (the connection layer rejects writes), so read scoping needs no per-table read tools. The `subjects` view (migration 006) gives `run_sql` a unified projection over anchors + entities. Each role instance runs in its own subprocess with its own connection (WAL keeps them coherent with main and with each other). A Claude Code subprocess for, say, mind-agent gets an MCP config pointing at the `digest-substrate-mcp[mind]` stdio process plus any external MCP servers (gmail-mcp, persona-emulator-mcp, or — in test mode — the per-service persona MCPs).

### What an agent invocation looks like end-to-end

1. Webhook arrives. Webhook server normalizes via the adapter, emits `webhook.persona` on the bus.
2. Mind dispatcher (durable, serialized subscriber) wakes. Queue length now 1.
3. Dispatcher pulls the event off its queue. Assembles:
   - System prompt = `disposition.md` + `mind-agent.md` (loaded from `~/digest/` or bundled defaults).
   - User prompt = the event payload, serialized.
   - MCP config = `{ "mcpServers": { "digest-substrate": { stdio path }, "gmail-mcp": { … }, "persona-emulator-mcp": { … } } }`.
4. Dispatcher calls `invokeClaudeCode(...)`. A `claude` subprocess spawns.
5. The subprocess runs its loop. Reads the substrate via `run_sql` and mutates it via the typed write tools (`create_entity`, `update_anchor_layer`, `support_prediction_precision`, …) over stdio. Each write tool call lands as a SQLite row in our substrate MCP server's read-write connection; `run_sql` uses the read-only connection.
6. Subprocess exits. `invokeClaudeCode` resolves with the outcome.
7. Mind dispatcher emits `mind.invocation.done`. Cursor advances.
8. Reminder scheduler, subscribed to `mind.invocation.done`, re-reads the `reminders` table and re-sorts its timer queue.
9. If the queue has more events, dispatcher pulls the next; otherwise it idles.

Diary, cold-start, and task execution follow the same shape. They differ in which prompt, which MCP servers, and which dispatcher triggers them.

## Permissionless mode

Every Claude Code invocation passes `--dangerously-skip-permissions`. No interactive permission prompts at runtime.

Architectural discipline is enforced through:

- **MCP tool catalogs.** A role's Claude Code can only call tools that its substrate MCP server has registered. The mind agent has none of the diary `write_*` component tools because its MCP server doesn't expose them; the diary agent has no `create_anchor` or precision tools for the same reason.
- **System prompts.** Each role's prompt specifies what to do, what to avoid, and what kind of move belongs in this turn.
- **Foreign keys and CHECK constraints in SQLite.** A bad tool call (id collision, dangling FK, invalid layer name) fails at the DB; the agent reads the error and adapts.

Permission gating at the LLM-loop level was a safety net for systems where the model might do unexpected things. In this design, the tool surface is the safety net — and it's narrower and more enforceable than a runtime prompt.

## Execution boundary

The digest agent never executes against the world. No `send_email`, no `accept_calendar_invite`, no `create_doc`. The mind / diary / cold-start agents have no such tools in their allowlists.

When the principal acts on a HITL component — clicks **Send** on an `email-draft`, picks **Decline** on a `calendar-block`, types a reply into a `free-text-reply` — the renderer captures the action and emits `task.fired` through IPC:

```ts
{
  task_id: string,                                 // new per task event
  component_id: string,                            // diary_components.id
  diary_date: string,                              // YYYY-MM-DD
  action: { id: string, kind: string },            // matches the component's actions array
  principal_input: unknown | null,                 // free-text content, picked option id, etc.
  context_pointers: {
    anchor_ids: string[],                          // diary_component_anchor_refs
    source_id?: string                             // e.g. gmail thread id, for replies
  }
}
```

The execution dispatcher subscribes to `task.fired`. It spawns a fresh Claude Code subprocess with:

- An **execution system prompt** ("you are the executor for a digest task; here is the component; here is the principal's action and input; here are the source pointers; execute and report").
- MCP servers: the external set (gmail-mcp, gcal-mcp, …). **No** substrate MCP — execution agents don't touch the cognitive layer.
- Permissionless mode.

On exit:

- Success → `task.completed` with the outcome payload (sent-message-id, calendar response ack, etc.).
- Failure → `task.failed` with the error message.

Both events flow into the mind dispatcher like any other observation. The mind agent updates the relevant anchor's case base, supports / contradicts the efference prediction tied to the component, and the loop closes.

The digest agent never sees a tool succeed or fail directly. It observes the world's response via subsequent events (the recipient's reply lands as a webhook; the attendee accepts a counter-proposal; etc.) and through the internal `task.completed` / `task.failed` events the execution dispatcher emits.

## Surfaces

### Diary view (primary)

A renderer window the principal opens from the tray. Journal-styled. See `02-diary-model.md` for the data and the HITL template library; see "Diary aesthetic" in the plan for the visual direction.

Key properties:

- Renders `diary_components` for today, sorted by `(section, position)`.
- Each component dispatches to a template module (`renderer/diary/templates/<template_id>.ts`).
- Templates wire their action affordances to `window.digest.fireTask({...})`, which IPCs to main.
- Comment fields call `window.digest.addComment(...)`; the bottom-of-page notes box calls `window.digest.addNote(...)`.
- `thinking_layer` is never rendered here. Inspector exposes it instead.

### Inspector

A renderer window for the agent's perspective. Shows:

- Anchors and entities (browse / search / readonly prose render).
- The events table (sorted desc, filterable by kind).
- The thinking_layer per day, per role.
- Pending and fired reminders.

Functional aesthetic — table-and-tree layouts, monospace where structure matters, full content visible. Not styled like the diary.

### Settings

A small renderer window that edits `config.jsonc`. Reads via `window.digest.readConfig()`, writes via `window.digest.writeConfig(json)`. Validates on save (timezone, webhook URL, time formats).

### Surface MCP (`/digest`)

The principal's Claude Code installs `digest-surface-mcp` as an MCP server. Five tools:

- `digest_run({ force })` — fires the diary dispatcher; blocks until the diary tick completes; returns the assembled diary JSON.
- `digest_get({ date })` — returns assembled diary JSON for the given date (default: today).
- `diary_act({ component_id, action, principal_input })` — emits `task.fired`; does not execute.
- `diary_add_comment({ component_id, text })` — writes a `diary_comments` row; emits `diary.comment.added`.
- `diary_add_note({ date, text })` — writes a `diary_notes` row; emits `diary.note.added`.

This surface is the agent-integration plane. The principal who lives in Claude Code can review the day via `/digest` without opening the Electron window.

## Configuration

`~/digest/config.jsonc` (see `10-config.md` for the full schema). Backend-specific additions:

- `claude_code.executable` — path to the `claude` CLI. Defaults to `claude` on PATH. The launcher uses this.
- `webhook.tunnel` — controls the bundled ngrok subprocess (see `10-config.md`).

## Module structure

```
digest-agent/
├── package.json
├── tsconfig.json  tsconfig.main.json  tsconfig.renderer.json
├── esbuild.config.mjs
├── electron-builder.json
├── prompts/                              # bundled agent prompts (read at runtime)
│   ├── disposition.md  mind-agent.md  diary-agent.md  cold-start-agent.md  execution-agent.md
│   ├── playbook/                         # on-demand prompt fragments (read_playbook_section)
│   │   ├── substrate-schema.md  action-classes.md  customize.md
│   │   ├── sections/  templates/  voice/  discipline/
│   └── seed-plays/                       # house plays → seeded into the plays table at boot
│
└── src/
    ├── main/
    │   ├── index.ts  boot.ts  tray.ts  windows.ts  bus.ts  ipc.ts
    │   ├── claudeCode.ts                 # Claude Code subprocess launcher
    │   ├── clock.ts  config.ts  testMode.ts  runtime-paths.ts
    │   ├── prompts/                      # prompt assembly (coldStartAgentPrompt.ts, diaryAgentPrompt.ts)
    │   ├── telemetry/langfuse.ts         # OpenTelemetry → Langfuse
    │   │
    │   ├── db/
    │   │   ├── index.ts  migrate.ts  migrations-path.ts  migrations/00{1..7}_*.sql
    │   │   ├── nodes.ts  anchors.ts  entities.ts  relationships.ts  predictions.ts
    │   │   ├── caseBase.ts  reminders.ts  diary.ts  events.ts  pendingEvents.ts
    │   │   └── plays.ts  seedPlays.ts
    │   │
    │   ├── webhook/                       # server.ts (Fastify, loopback)  tunnel.ts (ngrok)
    │   ├── scheduler/                     # reminders.ts  diary.ts  profileWatcher.ts  timezone.ts
    │   ├── dispatcher/                    # mind.ts  diary.ts  coldStart.ts  execution.ts  eventRelay.ts
    │   ├── test/                          # personaEmulator.ts  personaClockDriver.ts (test-mode infra)
    │   │
    │   └── mcp/
    │       ├── substrate/
    │       │   ├── server.ts              # one binary, launched per role via --role
    │       │   ├── catalog.ts             # role → tool-name allowlist; ALL_TOOLS map
    │       │   ├── tool.ts                # defineTool(); read-only vs read-write connection
    │       │   └── tools/
    │       │       ├── sql.ts             # run_sql (the single read tool)
    │       │       ├── readers.ts         # file readers: read_profile, *_playbook_section
    │       │       ├── anchors.ts  entities.ts  promote.ts  relationships.ts
    │       │       ├── predictions.ts  precision.ts  reminders.ts  plays.ts
    │       │       ├── diary.ts  diaryComponents.ts   # per-template write_* family
    │       │       └── _ids.ts
    │       ├── surface/                   # server.ts  tools.ts (principal's Claude Code)
    │       ├── personaEmail/  personaCalendar/  personaNotes/   # test-mode source MCPs
    │       └── _personaServer/buildServer.ts
    │
    ├── renderer/
    │   ├── preload.ts
    │   ├── diary/      # view.ts  frame.css  motion.ts  citations.ts  templates/<11 templates>.ts
    │   ├── inspector/  settings/  onboarding/
    │
    └── shared/
        ├── types/                         # config, diary, events, nodes, predictions, … (dir, not one file)
        ├── templates/                     # template registry — shared by substrate tools + renderer
        └── schemas/
```

## Failure modes and recovery

| Failure | Behavior |
|---|---|
| Daemon crash mid-event (after publish, before subscriber finishes) | Substrate state already on disk (each tool call commits). On restart, the bus replays from each durable subscriber's cursor; the event is processed exactly once. |
| Agent subprocess timeout | Dispatcher kills the subprocess on timeout; emits `mind.invocation.done` (or equivalent) with an error outcome. Substrate is left in its last-committed state. |
| Agent subprocess crashes | Same as timeout. The next event re-fires; substrate is read fresh. |
| Substrate MCP server subprocess crashes | Lifecycle subsystem restarts it. Any in-flight Claude Code subprocess that lost the MCP connection will error and exit; the dispatcher emits a failed outcome. |
| ngrok tunnel disconnects | Tunnel manager reconnects with exponential backoff. Webhook events buffered upstream by the provider (Gmail Pub/Sub retries; Google Calendar retries) are re-delivered on reconnect. |
| `config.jsonc` invalid on load | Main process refuses to boot; prints clear error to stderr; tray icon shows red badge. |
| SQLite migration fails mid-way | Migration runner uses transactions per migration file. A failed migration rolls back; `PRAGMA user_version` doesn't advance; the next boot retries. |
| Renderer crash | Main process detects via `webContents.on('crashed')`. Tray remains; user can re-open the window. Main process state is unaffected. |
| Two `digest_run` calls in flight | The second is queued behind the first. The diary scheduler holds a single in-flight token. |

## Verification

End-to-end smoke flow once Phase 12 of the implementation plan completes:

1. `npm run dev` boots the Electron app; tray icon appears.
2. `~/digest/digest.db` exists with every graph table.
3. `~/digest/profile.md` is edited and saved → cold-start dispatcher spawns Claude Code in permissionless mode → `nodes` and `anchors` rows for `_principal` appear.
4. `https://<ngrok-domain>/webhook/test` returns 200; tunnel manager logs the request.
5. Synthetic persona-generator event POSTed to `/webhook/persona-emulator` → `events` table grows → mind dispatcher spawns Claude Code → an entity (or anchor case-base entry) appears → `mind.invocation.done` emits.
6. Tray menu → "Run diary now" → diary dispatcher spawns Claude Code → `diary_days`, `diary_components`, `diary_component_anchor_refs` populate → each component has a `template_id` → `digest_get` from Claude Code returns the assembled JSON.
7. Open the diary window from the tray → today's diary renders with the journal aesthetic (paper background, serif typography, marginalia indicators); components render through their templates.
8. Click **Send** on an `email-draft` → marginalia "acted" glyph draws → `task.fired` emits → execution dispatcher spawns Claude Code with gmail-mcp → email sends → `task.completed` emits → mind dispatcher fires → anchor's case-base gains a row.
9. From the diary window, add a comment → `diary_comments` row inserted → `diary.comment.added` emits → mind dispatcher fires.
10. Open Inspector → see the principal anchor, the new entity, the events table; toggle to thinking-layer view → see today's reasoning entries.
11. Kill the app mid-event → restart → durable subscriber resumes from its cursor; event processed once.
12. Run a graph query from the Inspector SQL pane (or `sqlite3 digest.db`): `SELECT target_id FROM relationships WHERE subject_id = 'marcus_webb'` returns row(s) directly, no `json_extract` needed.

Pass = the backend is real, the graph is honest, the principal sees a diary, the cognition runs in Claude Code subprocesses, and execution lives outside the digest agent's boundary.
