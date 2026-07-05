# Daily Digest — Architecture Overview

A personal triage tool. It watches the principal's sources — inbox, calendar, notes, anything else hooked up — and produces a once-or-thrice-daily **diary** that surfaces what matters and embeds dispatchable action specs a calling agent can execute.

The fixture user is Avery Chen, a startup founder. The tool itself is content-neutral; everything user-specific (who matters, what to suppress, when to run, voice) lives in a user-authored `profile.md`.

## Thesis

**Agent-driven cognition over a graph substrate.**

The substrate — anchors, entities, predictions, relationships, reminders, diary — is data plus simple arithmetic, stored as a graph in SQLite. The decisions — what matches what, how a layer updates, when an entity becomes an anchor, what belongs in today's diary — are Claude Code subprocesses (permissionless) calling MCP tools that mutate the substrate.

There are no rule engines. There are no thresholds. The cognitive runtime is a small Electron app: it owns the SQLite database, an event bus, a webhook server, a tunnel manager, schedulers, dispatchers, and MCP servers — and it spawns a fresh Claude Code subprocess each time an agent needs to think.

For the full stack and process model, see [11-backend-architecture.md](11-backend-architecture.md).

## Three commitments

**Organize by interests, not tasks.** A digest sorted by event type ("emails / calendar / todos") is triage failure dressed as productivity. The diary sorts by the active *matters* — people, deals, projects, ongoing concerns. A drafted reply to an investor appears under that investor's anchor, not under "emails."

**Event-driven perception, deliberate composition.** The mind agent fires on individual events — webhooks, snapshot diffs, self-set reminders — and exits. The diary agent fires on schedule or on demand. Perception is continuous and cheap; composition is rare and deep.

**Honest cognition, not fabricated certainty.** Every claim carries the precision of the evidence behind it. High-precision items get committed reads; mid-precision items get hedged reads with falsifiers; low-precision items either don't surface or surface as "I'm not sure, here's the thread."

## What makes a digest good

Goodness composes from three sources:

1. **Universal principles** — surface what matters, suppress noise, prefer artifact over suggestion, default to silence when unsure. Lives in `disposition.md`; loaded as the system prompt for every agent.
2. **Declared calibration** — the principal's `profile.md`: who matters, what to suppress, voice, reading windows.
3. **Observed model** — the *principal-anchor*, an anchor about the principal themselves, seeded from `profile.md` and updated from observation.

When declared and observed diverge — principal said "ignore newsletters" but reads Stratechery carefully — the divergence becomes diary content, not a silent override.

## Two interfaces to the world

Exactly two interfaces between the cognitive core and the outside.

**Event source interface — push.** Webhooks from sources that push (inbox, calendar, future Slack / Linear / etc.) and the agent's own reminder firings. Each event becomes a single mind-agent invocation. No polling, no watchers — if a source doesn't push, it's not an event source.

**MCP server access — pull.** Gmail MCP, Calendar MCP, Slack MCP, Linear MCP, GitHub MCP, Claude Code skills exposed as MCP. The daemon configures servers per agent session; the SDK provides MCP discovery and invocation natively. The agent reaches for them when it needs evidence beyond the event payload.

The same product can present both. Gmail pushes new mail through a webhook; the agent queries Gmail MCP for older threads. Source kinds are free-form tags (`inbox-gmail`, `calendar-google`, `slack-acme`) — no hardcoded enum. See [04-adapters.md](04-adapters.md).

## The three agents

Each is a Claude Code subprocess in permissionless mode: `disposition.md` + per-agent prompt as the system prompt, a role-scoped substrate MCP server providing the tool catalog, external MCP servers (gmail, gcal, persona-emulator) for evidence. See [03a-agent-shape.md](03a-agent-shape.md) and [11-backend-architecture.md](11-backend-architecture.md).

**Mind agent.** Event-triggered. Receives one event as direct input. Owns the cognitive substrate: creates entities for new subjects (default) or anchors directly (high-conviction first sight); promotes entities to anchors as evidence accumulates; updates layers and relationship layers; supports, contradicts, or deletes predictions; sets reminders. The mind dispatcher serializes invocations — one event at a time.

**Diary agent.** Schedule-triggered (`config.jsonc`) or on-demand (`digest_run`). The diary dispatcher guarantees pending events have been processed first — the always-fresh guarantee. The agent reads the substrate as-is, composes today's diary as JSON (rows across the `diary_*` tables), validates dispatchable drafts against sources (via MCP), and emits efference-copy predictions on dispatched components. It does not create or promote substrate primitives — any composition-time observation that suggests promotion is left as a thinking-layer note for the next mind invocation.

**Cold-start agent.** One-shot at `digest init`, and re-fired on `profile.md` mtime change. Reads `profile.md` and seeds the **principal-anchor only**. Nothing else. Day 1 starts with one anchor; events arrive through the normal flow; entities emerge organically.

There is a fourth Claude Code subprocess kind — the **execution instance** — that is *not* a digest-cognitive agent. It is spawned by the execution dispatcher when the principal acts on a HITL component and is responsible for executing against the world (sending the email, accepting the calendar invite). See "The execution boundary" below.

## The substrate

```
~/digest/
├── profile.md            # principal-authored seed (prose)
├── config.jsonc          # operational settings (JSON with comments)
├── disposition.md        # universal system prompt; ships with tool
├── digest.db             # SQLite: anchors, entities, relationships,
│                         #   predictions, case_base_entries, reminders,
│                         #   diary_*, plays, events (bus audit log). WAL mode.
└── logs/                 # operational logs (errors, webhook receipts)
                          # plays now live in the digest.db `plays` table —
                          # house plays seed from prompts/seed-plays/ at boot
```

Notice what's not here: no stream log, no perception queue, no per-record JSON files. The cognitive substrate is a graph stored relationally in `digest.db` — anchors and entities as nodes, relationships as edges, citations as case-base rows, every diary day decomposed across `diary_days`, `diary_components`, `diary_comments`, `diary_notes`, `diary_thinking_entries`. Source content (emails, calendar entries, notes) lives in its source; the agent queries via MCP to revisit evidence. The bus's audit log (`events` table) is also in the DB.

For the schema and the rationale behind it, see [11-backend-architecture.md](11-backend-architecture.md). Field-level semantics for anchors, entities, and the diary live in [01-anchor-model.md](01-anchor-model.md), [01a-entity-model.md](01a-entity-model.md), [02-diary-model.md](02-diary-model.md).

## Event flow

A source produces an event. The webhook server (or the reminder timer, or the renderer's IPC bridge) emits it on the in-process event bus. The mind dispatcher — a durable, serialized subscriber — pulls the event, spawns a Claude Code subprocess with the mind-agent system prompt and the mind-substrate MCP server, and awaits its exit. The subprocess updates the substrate via MCP tools (which write SQLite rows directly). On exit, the dispatcher emits `mind.invocation.done`. The next event waits its turn.

On schedule or on demand, the diary dispatcher pulls a `schedule.diary_tick` event, waits for the mind queue to drain, then spawns the diary-agent Claude Code subprocess. See [03-cycle.md](03-cycle.md) and [11-backend-architecture.md](11-backend-architecture.md).

## Case base cites source IDs

Anchors and entities have case-base entries — one row per citation in `case_base_entries`, each pointing at a **source ID directly**: `gmail:msg_abc123`, `gcal:event_xyz`, `notion:page_456`. To revisit evidence, the agent calls the corresponding MCP server with that ID. The source is the canonical record; the digest doesn't shadow-copy it. The optional `note` column carries the agent's commentary stamp for why the citation matters; the `source_id` is what's load-bearing.

## The diary is the sole contract

Everything the principal sees is in the diary. Anchors, entities, reminders, events — all internal. **If something matters to the principal, it must be in the diary.** If it isn't, that's a composition bug, not an API gap.

## The diary as A2UI

Structured rows that assemble into a JSON document on read. Sections (Right Now / On the Desk / Tracking / Background) hold typed components — dispatchable (`email-draft`, `calendar-block`, `choose-one`, `free-text-reply`) and informational (`diary-prose`, `big-number`, `stat-block`, `chart`, `report`); there is no `doc-tile`. Each component carries `actions`, `status`, `comments`, a `template_id` selecting which HITL template renders it, and (where dispatchable) a pointer to its efference prediction on the primary anchor.

The **primary surface** is the Electron diary view — a journal-styled window the principal opens from the tray. It renders each component through its HITL template, gives the page a paper aesthetic (warm serif typography, generous margins, marginalia status indicators, hand-curated SVG flourishes), and animates state transitions restrainedly. The `thinking_layer` is never rendered in the diary view; Inspector exposes it instead.

The **secondary surface** is the Claude Code MCP plugin (`/digest`). It calls `digest_get` to fetch the assembled diary JSON and renders it inline with Claude Code's A2UI. Useful for principals who already live in Claude Code.

The principal interacts via the diary view's action buttons (which IPC to main and emit `task.fired`), the diary's comment fields (`diary_add_comment` via IPC), and the bottom-of-page notes box (`diary_add_note` via IPC). The MCP plugin exposes equivalent tools for the Claude Code surface.

See [02-diary-model.md](02-diary-model.md), [07-execution-surfaces.md](07-execution-surfaces.md), [11-backend-architecture.md](11-backend-architecture.md).

## The execution boundary

The digest agent's responsibility ends when the diary lands. It produces artifacts — drafted emails, calendar decisions, choose-one prompts — and exits. It has **no tools that act on the world**. The mind / diary / cold-start agents' allowlists confirm this: no `send_email`, no `accept_calendar_invite`, no `create_doc`.

When the principal acts on a HITL component, the renderer (or the MCP plugin's `diary_act`) emits **`task.fired`** on the bus. The execution dispatcher subscribes to this event and spawns a fresh **Claude Code subprocess** in permissionless mode — separate from the digest agents — with the external MCP servers (gmail-mcp, gcal-mcp, …) and no substrate access. It executes against the world and exits. On exit, the dispatcher emits `task.completed` or `task.failed`, which the mind dispatcher consumes like any other observation.

The world is the canonical record of action. The next inbound webhook observes the consequences through the same interface that fed perception.

## MCP surfaces

Two MCP servers, two audiences.

**`digest-surface-mcp`** — external. Installed in the principal's Claude Code (`~/.claude/mcp.json`). Five tools:

- `digest_run(force=false)` — fires a diary tick, returns the assembled diary JSON.
- `digest_get(date=null)` — returns assembled diary JSON for today or a specified date.
- `diary_act(component_id, action, principal_input)` — emits `task.fired` (does NOT execute).
- `diary_add_comment(component_id, text)` — principal-authored comment.
- `diary_add_note(date, text)` — principal-authored bottom-of-page note.

**`digest-substrate-mcp[role]`** — internal. Three role-scoped instances (mind / diary / cold-start), each registering exactly its role's tool allowlist from [03a-agent-shape.md](03a-agent-shape.md). Used only by spawned Claude Code agent subprocesses; never exposed outward.

The agents' *inbound* MCP access to source-side servers (Gmail MCP, Calendar MCP, persona-emulator MCP, Notion MCP, etc.) is configured per agent role in `config.jsonc` and routed by Claude Code's standard MCP discovery — we don't wrap or proxy.

## Cuts from precedent

Load-bearing rejections:

- **No stream queue.** Events are triggers; cognitive state is memory. Dedup lives in a small daemon cache; history lives in sources.
- **No backfill.** `digest init` seeds the principal-anchor and exits. Historical context loads on demand via MCP.
- **No source-specific query tools.** The SDK provides MCP fluency natively. We don't define `query_inbox`, `query_calendar`, `query_notes`, `call_mcp`. The agent has ambient access to configured MCP servers.
- **No clock cycle for the mind.** One event, one invocation.
- **No threshold-based anchor emergence.** Anchors enter through mind-agent judgment — either directly on a high-conviction observation or by promotion from an accumulating entity. Mention count is a proxy, not a gate. The principal-anchor is the lone exception (cold-start seed).
- **No prediction state machine.** Support → up, contradict → down, irrelevant → delete. No `held / failed / expired` enums.
- **No `task-item` component.** Tasks unified into notes; todos surface as ordinary text.
- **No markdown diary.** The diary is JSON.
- **No back-channel from executor.** `diary_act` confirms completion; it does not push results into anchors. The world is observed, not instrumented.

## How to read the rest

- [01-anchor-model.md](01-anchor-model.md) — anchor schema, layers, precision arithmetic, predictions, principal-anchor.
- [01a-entity-model.md](01a-entity-model.md) — the entity primitive, edges, promotion.
- [02-diary-model.md](02-diary-model.md) — diary schema, A2UI components, HITL template library, comments, carry-forward.
- [03-cycle.md](03-cycle.md) — agent invocations, lazy time, always-fresh serialization, execution lane.
- [03a-agent-shape.md](03a-agent-shape.md) — agent roles, MCP tool catalogs per role, permissionless mode.
- [04-adapters.md](04-adapters.md) — event source adapters (persona-emulator first), MCP server access, stable IDs.
- [05-plays.md](05-plays.md) — play file shape.
- [06-profile-schema.md](06-profile-schema.md) — fields in `profile.md`.
- [07-execution-surfaces.md](07-execution-surfaces.md) — CLI, MCP, diary view rendering.
- [08-runtime.md](08-runtime.md) — the Electron main process's subsystems.
- [09-eval.md](09-eval.md) — Avery rubric mapped to A2UI components.
- [10-config.md](10-config.md) — `config.jsonc` schema and `digest init`.
- **[11-backend-architecture.md](11-backend-architecture.md)** — the actual backend: TypeScript + Electron + SQLite (full DDL) + event bus + MCP servers + Claude Code subprocesses. Process model, module structure, failure modes.
- `prompts/` — disposition plus one per agent.
- `diagrams/` — Excalidraw views.
