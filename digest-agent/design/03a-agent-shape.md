# Agent Shape

The cognitive work is done by three Claude Code subprocesses running in permissionless mode: the **mind agent**, the **diary agent**, and the **cold-start agent**. This doc specifies why we chose this shape, the per-role MCP tool catalogs that enforce architectural invariants, how external MCP access works, the shared sub-schemas, the load-bearing tool I/O schemas, and the discipline around output and reasoning.

The cycle this shape supports is in [03-cycle.md](03-cycle.md). The substrate the agents read and write is in [01-anchor-model.md](01-anchor-model.md), [01a-entity-model.md](01a-entity-model.md), and [02-diary-model.md](02-diary-model.md). The runtime that hosts the agents is in [11-backend-architecture.md](11-backend-architecture.md).

## Why Claude Code subprocesses

Earlier sketches wrapped LLM calls in deterministic code: a "mind tick" function would compute what to do, then call the LLM only at the moments judgment was needed. That works until the moments multiply. What started as "one LLM call for anchor update" became "one for matching, one for layer assignment, one for prediction generation, one for status assessment" — each with its own retry path, its own format guard, its own debugging surface.

The agent-driven shape inverts the relationship. The agent is given a goal, a system prompt, and a tool surface; it decides what to do. The tools are the substrate. The arithmetic the tools encapsulate (precision updates, decay computation, row writes) is not a separate layer of reasoning; it's the protocol the agent operates through.

We use the **Claude Code CLI** in headless / permissionless mode (`claude --dangerously-skip-permissions --system-prompt … --mcp-config …`) for every agent invocation. This applies to mind, diary, cold-start, and execution. No in-process LLM loop. No dependency on `@anthropic-ai/claude-agent-sdk`.

Two consequences shape everything below:

1. **MCP tool catalogs are architectural rules.** The diary agent cannot create anchors because the substrate MCP server it connects to does not register `create_anchor`. The architecture enforces "agent judgment, not rule" by *which decisions which agent can make*, not by code branches. Tool scoping happens at the MCP server boundary.
2. **Reasoning is free between tool calls.** The agent thinks in prose between calls; the tool calls are the durable record. Output discipline (later section) keeps the prose disciplined too.
3. **Permissionless mode applies everywhere.** Every Anthropic invocation — mind, diary, cold-start, execution — runs with permission prompts bypassed. Discipline lives in tool catalogs and prompts; runtime gates are not the safety net.

## Tool catalogs are served by substrate MCP servers

The digest defines its own internal tool surface — the read/write operations against anchors, entities, predictions, reminders, the case base, plays, and the diary. One substrate MCP server binary (`src/main/mcp/substrate/server.ts`) is launched once per role with a `--role={mind|diary|cold-start}` flag; each instance registers exactly its role's allowlist from `catalog.ts`:

- `digest-substrate-mcp[mind]` — the mind allowlist (creation, mutation, deletion across the substrate; precision arithmetic; reminders).
- `digest-substrate-mcp[diary]` — reads + diary-only writes (the per-template `write_*` component family, `clear_diary`, `delete_diary_component`, `append_thinking_layer`, `emit_efference_prediction`).
- `digest-substrate-mcp[cold-start]` — the mind allowlist plus `create_play`.

The access surface has the same shape for every role:

- **Reads go through a single `run_sql` tool.** Every role gets read-only SQL (`SELECT` / `WITH` / `PRAGMA` / `EXPLAIN`) against the substrate. The connection is opened read-only, so `INSERT` / `UPDATE` / `DELETE` throw at the SQLite layer — read scoping is enforced by the connection, not by which read tools exist. The schema and query patterns are documented in the `substrate-schema` playbook (loaded on demand via `read_playbook_section`), and the `subjects` view gives a unified `(id, subject_kind, name, kind, last_active)` projection over anchors + entities so the agent doesn't hand-JOIN them. This replaces the old fixed read tools (`read_anchor`, `list_anchors`, `read_entity`, `read_diary`, `list_plays`, …), which are gone.
- **Writes go through small, typed, REST-style tools** — one per operation, grouped by domain. The server owns ID generation, multi-step atomicity, FK ordering, and the precision arithmetic — all things an LLM is unreliable at composing in raw SQL.
- **The only non-SQL reads are the file readers** — `read_profile`, `list_playbook_sections`, `read_playbook_section` — because the profile and the playbook fragments live on disk, not in the DB.

When the mind dispatcher spawns a Claude Code subprocess, its `--mcp-config` points at the `digest-substrate-mcp[mind]` stdio process; the agent only sees mind-role tools. The same pattern applies to diary and cold-start. Process isolation between the role-scoped server instances backs the architectural rule with a real boundary.

See [11-backend-architecture.md](11-backend-architecture.md#agent-runtime) for the substrate MCP server lifecycle and the launcher contract.

## External MCP access

Source-side MCP servers (Gmail MCP, Calendar MCP, Slack MCP, persona-emulator MCP, Notion MCP, …) are managed by the main process's MCP lifecycle subsystem and exposed to agent invocations via the same `--mcp-config` mechanism. The agent calls something like `mcp__gmail__get_message(message_id="msg_abc123")` directly; Claude Code's standard MCP routing handles the rest.

What this means concretely:

- The digest doesn't wrap, proxy, or rate-limit external MCP calls.
- The digest doesn't enumerate the external MCP tool surface in its prompts. Claude Code injects MCP tool schemas into the agent's working context.
- New external MCP servers attach by editing `config.jsonc`. No digest code changes.

### Per-role MCP server lists

`config.jsonc` declares which external MCP servers each agent role has access to. Example:

```jsonc
{
  "agent_mcp_access": {
    "mind":       ["gmail-mcp", "gcal-mcp", "persona-emulator-mcp", "notion-mcp"],
    "diary":      ["gmail-mcp", "gcal-mcp", "persona-emulator-mcp", "notion-mcp"],
    "cold_start": []  // cold-start does not query history
  }
}
```

The dispatcher reads this when assembling the Claude Code subprocess's MCP config. The mind agent and diary agent typically have the same external MCP access (any source they observe via events, they can query via MCP). The cold-start agent gets none — by design.

See [10-config.md](10-config.md) for the full config schema.

## Three agents, one base

Every agent invocation has the same scaffolding:

```
claude --dangerously-skip-permissions \
       --system-prompt @<file> \           # disposition.md + <role>-agent.md
       --mcp-config @<file>                # role's substrate MCP + role's external MCPs
       < <user_prompt-on-stdin>            # the event payload (mind) or composition goal (diary)
```

`disposition.md` ships with the tool and never changes per user. It carries the three operating principles, the voice register, the twelve reasoning moves, the precision-honesty discipline, and the A2UI component discipline. Every agent reads it.

The agent-specific prompts (`mind-agent.md`, `diary-agent.md`, `cold-start-agent.md`) layer on top with the agent's particular job and the contract for its substrate MCP tools.

## Per-role MCP tool catalogs

The tables below cover the **substrate MCP** tools each role's server registers. External MCP tools (Gmail, Calendar, …) are not enumerated here — they come from `agent_mcp_access` in `config.jsonc`.

### Mind agent

The mind agent owns the cognitive substrate. Anchors, entities, predictions, relationships, and reminders are all created, updated, and retired here. It does not write the diary.

**Reads** (`run_sql` + file readers):

| Tool | Purpose |
|---|---|
| `run_sql(sql, params?)` | The single read surface. Read-only SELECT/WITH/PRAGMA/EXPLAIN against the documented schema. Read `_principal`, scan the `subjects` view, deep-read any anchor/entity, its `case_base_entries`, `relationships`, `predictions`, the `plays` table, pending `reminders`. |
| `read_profile()` | Principal's prose self-description (file, not SQL) |
| `list_playbook_sections()`, `read_playbook_section(name)` | The on-demand prompt-fragment library, including `substrate-schema` |

**Writes** (typed, one per operation):

| Domain | Tools |
|---|---|
| Anchor lifecycle | `create_anchor`, `update_anchor_layer`, `update_anchor_meta`, `bump_anchor`, `delete_anchor` |
| Entity lifecycle | `create_entity`, `bump_entity`, `update_entity`, `delete_entity`, `promote_entity` |
| Shared (anchor + entity) | `update_identity_handles`, `cite` |
| Relationships | `create_relationship`, `update_relationship_layer`, `delete_relationship` |
| Predictions | `create_prediction`, `delete_prediction` |
| Precision arithmetic | `support_anchor_precision`, `contradict_anchor_precision`, `support_relationship_precision`, `contradict_relationship_precision`, `support_prediction_precision`, `contradict_prediction_precision` |
| Reminders | `set_reminder`, `cancel_reminder` |

**Plus MCP tools** for the servers listed under `agents.mind.mcp_servers`. The mind agent uses these to read evidence beyond the event payload — pull the rest of a thread, fetch a doc, walk back calendar history.

Explicitly **not** on the mind allowlist: the diary write tools (`write_*` component family, `append_thinking_layer`, `emit_efference_prediction`) and `create_play`. The mind agent does not write the diary, and it does not author plays — play authoring is a cold-start move.

Note the precision split: precision now moves through a dedicated **support/contradict** tool per target (anchor layer / relationship layer / prediction), rather than being a `kind_of_evidence` argument to an update tool. Content edits (`update_anchor_layer`, `update_relationship_layer`) and confidence moves (`support_*` / `contradict_*`) are separate calls.

The judgment call between `create_entity` and `create_anchor` is one of the most important design hinges. Default to entity — cheap, provisional, easy to retire. Reach for `create_anchor` only when the event itself carries enough signal that committing on first sight is warranted: a term sheet from a brand-new investor, an invite from someone profile.md names as P0, a hire offer from a candidate the principal hasn't met yet. Most observations should produce entities; most anchors enter via `promote_entity` once evidence has accumulated.

### Diary agent

The diary agent composes the diary from the substrate as it stands. It reads the substrate (via `run_sql`) but only writes the diary.

| Tool | Purpose |
|---|---|
| `run_sql(...)` | Read-only access to the whole substrate (anchors, entities, predictions, relationships, plays, reminders, past `diary_*` rows) |
| `read_profile()`, `list_playbook_sections()`, `read_playbook_section(name)` | Profile + the playbook (sections, templates, voice, discipline, `substrate-schema`) |
| `write_<template>(...)` × 11 | One per HITL template (`write_email_draft_inline`, `write_calendar_block_decision`, `write_choose_one_cards`, `write_diary_prose_note`, …). Each is registry-derived and validates its content against the template's schema before persisting the component row. |
| `clear_diary(date)`, `delete_diary_component(component_id)` | Reset / remove components during composition |
| `append_thinking_layer(date, entries[])` | Add to the day's agent journal (never rendered to the principal; Inspector-only) |
| `emit_efference_prediction(anchor_id, prediction_spec)` | Attach an efference-copy prediction to an anchor (tied to a dispatchable component) |

**Plus MCP tools** for the servers listed under `agents.diary.mcp_servers`. Used heavily during dispatchable validation — the agent reads source threads to ground draft claims.

The per-template `write_*` family replaced the old monolithic `write_diary(date, content_json)`: the diary is built component by component, each through the typed tool for its template, so the schema is enforced per component rather than over one large JSON blob.

Explicitly **not** on the diary agent's allowlist: `create_anchor`, `create_entity`, `promote_entity`, `delete_entity`, `update_anchor_layer`, `update_relationship_layer`, the precision tools, and every other substrate write. If the diary agent realizes mid-composition that an entity deserves anchorhood, it composes around the entity as-is and notes the observation in the thinking layer; the next mind invocation will see it and decide. Substrate ownership stays with the mind agent.

The single exception is `emit_efference_prediction`. That tool attaches a prediction to an anchor only when the diary surfaces a dispatchable component — the prediction is a side effect of the dispatch, not free substrate authoring.

### Cold-start agent

Cold-start uses the **same fine-grained mind toolset** (no bundled "seed everything" mega-tool — invariants stay enforced uniformly) **plus `create_play`**. It seeds the substrate from `profile.md` and the observed history: the principal-anchor, the entities and anchors visible in the scanned window, opening reminders for dated commitments, and a set of persona-custom plays derived from how the principal actually handles recurring moments.

| Tool | Purpose |
|---|---|
| *(all mind read + write tools above)* | Seed anchors / entities / relationships / predictions / reminders; read via `run_sql` for idempotency checks |
| `create_play(name, title, content, derived_from?)` | Write a persona-custom play into the `plays` table, generalized from observed source IDs |

`create_play` is **cold-start–only**: the principal's plays are derived once, at seeding, from real observed behavior. The mind agent does not author plays at runtime (see [05-plays.md](05-plays.md)). House plays — generic reasoning / how-to / triage precedents — are seeded separately at boot from bundled markdown, independent of any agent.

## Shared schemas

These sub-schemas are the single source of truth across the design. Anchors, entities, predictions, and tool I/O all reference them. Other docs (`01-anchor-model.md`, `01a-entity-model.md`, `02-diary-model.md`, `03-cycle.md`) link here instead of restating the structures.

### `case_base_entry`

A citation in the agent's reasoning trail. Points at canonical source content via `source_id`; carries minimal local metadata so the agent can reason without round-tripping MCP for every read.

```json
{
  "source_id": "gmail:CAG5152a@mail.gmail.com",
  "date": "2026-05-12",
  "note": "first direct question on option pool"
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `source_id` | string | yes | Canonical pointer: `<source-tag>:<stable-id>`. Examples: `gmail:<message-id>`, `gcal:<uid>`, `slack:<channel>/<ts>`, `notion:<page-id>`. The agent fetches via the corresponding MCP server when it wants the underlying content. |
| `date` | ISO 8601 date | yes | The date the event occurred. Local metadata, not source content. Needed for layer arithmetic, decay reasoning, and `expected_by` proximity without an MCP call. |
| `note` | string | optional | Agent's commentary stamp — *why* this evidence mattered ("cc'd on cap-table v1 reply", "first direct question on option pool"). Distinct from a source-content copy: this is the agent's interpretation, not the source's text. |

The architecture never stores source content here. Snippet-of-the-email or excerpt-of-the-doc belongs in the source, fetched on demand. The `note` is the agent's stamp, not the source's words.

### `layer_object`

The body of a slow / mid / fast layer on an anchor. Three fields: prose content, current precision, and the supporting case base.

```json
{
  "content": "Marcus has run partner-side diligence at IPV for three rounds…",
  "precision": 0.84,
  "case_base": [
    {"source_id": "gmail:msg_abc", "date": "2026-04-19", "note": "first cap-table reply"},
    {"source_id": "gmail:msg_def", "date": "2026-05-02", "note": "follow-up on 409A"}
  ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `content` | string | yes | Prose claim(s) for the layer. Inner-mode voice; evidence-anchored. |
| `precision` | float ∈ [0.05, 0.95] | yes | Calibration of the content as a whole. See `precision_arithmetic`. |
| `case_base` | array of `case_base_entry` | yes (may be empty) | Citations grounding this layer's content. A layer with claims and an empty case base is a slogan; the agent's discipline is to cite. |

Anchor layers use this shape directly. Relationship layers do **not** — they use `relationship_layer` (below), which is lighter.

### `relationship_object`

A directed edge from a subject (anchor or entity) to an anchor target. Three independently-evolving layers — slow / mid / fast — each carrying a short claim and a precision.

```json
{
  "id": "rel_to_marcus_webb",
  "target": "anchor:marcus_webb",
  "slow": {"claim": "Lead partner across this round", "precision": 0.86},
  "mid":  {"claim": "Pushing on option-pool sizing", "precision": 0.62},
  "fast": {"claim": "Quiet 48h after term-sheet draft", "precision": 0.55}
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique within the subject's `relationships` array. |
| `target` | string | yes | Always prefixed `anchor:`. The same id remains valid across entity-to-anchor promotion. Entity-to-entity edges are not supported. |
| `slow` / `mid` / `fast` | `relationship_layer` | yes | Per-layer claim + precision. Layers update independently when evidence arrives. |

`relationship_layer` is `{ "claim": string, "precision": float ∈ [0.05, 0.95] }`. Relationship layers do **not** carry their own case base — the edge cites evidence through the subject's anchor-layer case bases.

### `prediction_object`

A standing prediction the agent commits to and later rules on. Three kinds — `event`, `fact`, `pattern` — share most fields.

```json
{
  "id": "pred_marcus_reply_2026_05_24",
  "kind": "event",
  "claim": "Marcus replies within 24h on the cap-table v3 follow-up",
  "expected_by": "2026-05-24T17:00-08:00",
  "based_on": ["mid", "fast"],
  "precision": 0.65,
  "created_at": "2026-05-23T11:04-08:00",
  "source_dispatchable": "diary/2026-05-23#cap_table_followup"
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable id; often timestamp-derived. |
| `kind` | enum `event` \| `fact` \| `pattern` | yes | The shape of the claim. Event: time-bounded. Fact: assertable now. Pattern: recurring tendency. |
| `claim` | string | yes | Falsifiable prose. |
| `expected_by` | ISO 8601 datetime | conditional | Required for `event`; omitted for `fact` and `pattern`. |
| `based_on` | array of `"slow" \| "mid" \| "fast"` | yes | Which anchor layers this prediction derives from. On support/contradict, each named layer also moves. |
| `precision` | float ∈ [0.05, 0.95] | yes | The agent's confidence at the time of the prediction. Updates per `precision_arithmetic`. |
| `created_at` | ISO 8601 datetime | yes | When the prediction was committed. |
| `source_dispatchable` | string | optional | Set when the prediction is an efference copy attached to a diary component. Format: `diary/<date>#<component_id>`. |

There is **no `status` field**. The agent's interaction is ternary: support → precision up, contradict → precision down, deem irrelevant → delete.

### `precision_arithmetic`

The same arithmetic governs precision updates on anchor layers, relationship layers, and predictions. Defining it once here lets every doc reference it without restating the formulas.

**Update rule, applied to a precision `p ∈ [0.05, 0.95]`:**

- **Support:** `p ← min(0.95, p + (1 - p) × 0.10)`. Asymmetric: low-precision claims update aggressively; high-precision claims resist (one off-pattern event does not overturn a 0.90 slow claim).
- **Contradict:** `p ← max(0.05, p - p × 0.30)`. Multiplicative drop: high-precision claims fall further per contradiction (a 0.90 claim drops by 0.27; a 0.30 claim drops by 0.09).
- **Deem irrelevant:** delete the object. No third evidence kind.

**Cascade for predictions:** when `support_prediction_precision(prediction_id)` or `contradict_prediction_precision(prediction_id)` is called, the same arithmetic runs on the prediction's own precision **and** on each anchor layer named in `based_on`. The prediction movement plus its layer movements happen in one tool call.

**Cascade for relationships:** each layer updates independently — `support_relationship_precision` / `contradict_relationship_precision` (with a `layer` argument) moves exactly one layer's precision. The slow / mid / fast layers of a relationship do not cascade into each other.

**Content vs. confidence are separate calls.** `update_anchor_layer` / `update_relationship_layer` rewrite prose only; they do not touch precision. Precision moves exclusively through the `support_*` / `contradict_*` family. This is the deliberate split introduced in the substrate refactor — an LLM editing a claim should not silently also be re-scoring its own confidence.

**Clamps:** precision is clamped to `[0.05, 0.95]` on every update. The floor (0.05) ensures the agent never claims certainty-against; the ceiling (0.95) ensures the agent never claims certainty-for.

## Digest-internal tool schemas

Each tool is defined with a zod input schema via `defineTool(...)`. **The authoritative schemas are the zod definitions** in `src/main/mcp/substrate/tools/*.ts` (`anchors.ts`, `entities.ts`, `promote.ts`, `relationships.ts`, `predictions.ts`, `precision.ts`, `reminders.ts`, `plays.ts`, `diary.ts`, `diaryComponents.ts`, `sql.ts`, `readers.ts`); `zod-to-json-schema` projects them into the MCP tool list the agent sees. The notes below capture the contract and the side effects — every write lands as a row (or rows) in `~/digest/digest.db`, **not** a JSON file. The substrate moved from per-record JSON files to relational SQLite in the backend refactor; see [11-backend-architecture.md](11-backend-architecture.md).

**`create_entity`** — `{ display_name, kind_hint?, identity_handles?, notes? }`. Inserts a `nodes` row (`kind='entity'`) and an `entities` row; the entity's slug `id` is server-derived from `display_name`. Errors on id collision with an existing anchor or entity. Provisional first-sight primitive; most subjects enter here.

**`create_anchor`** — `{ display_name, kind, slow{content,precision}, mid?, fast?, identity_handles? }`. Inserts a `nodes` row (`kind='anchor'`) and an `anchors` row with the supplied layer content + precision. `slow` is the only required layer. Reserved for high-conviction first-sight commitments — most anchors enter via `promote_entity` once evidence accumulates.

**`promote_entity`** (formerly `promote_entity_to_anchor`) — `{ entity_id, display_name?, slow, mid?, fast? }`. Atomic, in-place: flips the existing `nodes.kind` from `entity` to `anchor` and writes the `anchors` row **under the same id**, carrying the entity's case base into the slow layer and its relationships over verbatim, then drops the `entities` row. Same-id is the invariant that keeps pre-promotion relationship edges resolving.

**`update_anchor_layer`** — `{ anchor_id, layer, content }`. Rewrites one layer's prose. Does **not** touch precision. (`update_anchor_meta`, `bump_anchor` cover display_name/kind and activation bumps.)

**Precision family** — `support_anchor_precision` / `contradict_anchor_precision` (`{ anchor_id, layer }`), `support_relationship_precision` / `contradict_relationship_precision` (`{ subject_id, target_id, layer }`), `support_prediction_precision` / `contradict_prediction_precision` (`{ prediction_id }`). Each applies `precision_arithmetic` to its target. The prediction variants also cascade to every anchor layer named in the prediction's `based_on` bindings, in one call. This replaced the old `update_prediction(..., kind_of_evidence)` / `update_relationship_layer(..., kind_of_evidence)` evidence-argument pattern — confidence moves are now their own tools, separate from content edits. To retire a prediction, call `delete_prediction(prediction_id)`; there is no third evidence kind.

**`cite`** — `{ node_id, source_id, date, layer?, note? }`. Appends a `case_base_entries` row (the `note` carries the agent's commentary stamp; `layer` is null for entities). Citations are added through `cite`, not folded into the layer-update tools.

**`set_reminder`** — `{ fires_at, context, anchor_ids? }`. Inserts a `reminders` row plus its `reminder_anchor_refs` atomically. The reminder scheduler tails the table and sleeps until `fires_at`; on fire it emits `reminder.fired`, the mind dispatcher picks it up, and a mind-agent subprocess spawns. See [08-runtime.md](08-runtime.md) and [11-backend-architecture.md](11-backend-architecture.md).

**Diary writes** — the per-template `write_<template>` family (one tool per HITL template, content validated against the template's registry schema), plus `clear_diary`, `delete_diary_component`, `append_thinking_layer`, `emit_efference_prediction`. These INSERT/UPDATE `diary_components`, `diary_thinking_entries`, and `predictions` rows for the day. The monolithic `write_diary(date, content_json)` is gone — the diary is built one validated component at a time.

**`create_play`** (cold-start only) — `{ name, title, content, derived_from? }`. Upserts a `plays` row. `derived_from` is a JSON array of the source IDs the play generalizes from.

**`run_sql`** — `{ sql, params? }`. The single read tool, read-only at the connection layer. Returns `{ rows, row_count }`. Schema + query patterns are in the `substrate-schema` playbook section.

## Output discipline

Free reasoning between tool calls is the norm; the agent's prose is part of its judgment. Two disciplines:

**Structured output where it matters.** Diary content is JSON validated against schema. Layer content is prose. Prediction claims are prose. Reasoning between tool calls is prose. The tool boundary is where structure is required; everywhere else, the agent writes the way it thinks.

**No fabricated tool calls.** The disposition's honesty contract — `default-off surfacing` — extends to tools. If the agent doesn't have evidence to call `support_prediction_precision(...)`, it doesn't. The architecture refuses synthetic confirmation; a quiet anchor is allowed to stay quiet.

## Failure modes

**Tool call rejected.** A tool can return an error (`id collision`, `entity not found`, `schema invalid`). The agent must read the error and adapt. The runtime does not silently swallow tool errors; they appear in the agent's working context.

**Agent goes off-task.** The agent's prompt scopes the goal tightly. If the agent starts trying to read every anchor in the system on every mind-agent invocation, the prompt is wrong. The fix is in the prompt, not the tool layer.

**Agent loops.** The SDK runtime imposes a per-invocation step ceiling. A mind agent that hasn't made progress after N tool calls is force-exited; the substrate is left in its last committed state. The next event re-fires a fresh invocation.

**Crash mid-invocation.** Any partial state is in SQLite (each MCP tool call commits its own write or is wrapped in a transaction that does). The next invocation re-reads from the DB; the mind dispatcher's serialization ensures no concurrent invocations stomp. Durable bus subscribers (mind, diary, execution) resume from their cursor on restart, so the in-flight event isn't lost.

**MCP server unavailable.** The agent gets an error from the SDK; it reasons over what it has. The architecture does not require any MCP server to be present — they enrich, they don't gate.

## Dispatcher–agent contract

The Electron main process is the runtime host. It does not reason. Its job is to call the right agent at the right time with the right context. Specifically:

- Webhooks, reminder fires, principal comments/notes, and `task.completed`/`task.failed` all become bus events.
- Each event triggers a mind-agent subprocess via the mind dispatcher, serialized one at a time.
- A `schedule.diary_tick` or `digest_run` call triggers the diary-agent subprocess via the diary dispatcher, which waits for pending mind work to complete first.
- A `profile.changed` event (or `digest init`) triggers the cold-start subprocess via the cold-start dispatcher.
- A `task.fired` event triggers an execution Claude Code subprocess via the execution dispatcher.

The dispatchers are detailed in [08-runtime.md](08-runtime.md) and [11-backend-architecture.md](11-backend-architecture.md). The agents do not call the dispatchers; the dispatchers spawn the agents.

## Why three agents, not one

A single agent doing all jobs would conflate timescales: perception is cheap and frequent; composition is expensive and rare; seeding is once. Separating them lets each have a sharp goal, a small allowlist, and a budget tuned to its work.

It also lets the catalog do architectural work. The diary agent's exclusion from substrate writes — `create_anchor`, `create_entity`, `promote_entity`, `update_*`, the precision family — is enforced by the substrate MCP server it connects to, not by convention. The diary agent cannot accidentally modify the substrate while composing; the separation between perception (mind) and composition (diary) is enforced at the MCP server boundary.

The cost is some duplication: the diary agent reads the same anchors and entities the mind agent has already touched. The reward is auditability — each agent's tool calls are a clean record of "what this agent did," and the boundary between perception and composition is mechanical.

A fourth Claude Code subprocess kind — the **task execution instance** — lives outside this trio. It is not a cognitive agent; it runs against the world (sending email, accepting invites) when `task.fired` arrives. See [02-diary-model.md](02-diary-model.md#action-affordances-and-the-execution-boundary) and [03-cycle.md](03-cycle.md#the-execution-lane-task-events--claude-code-execution--outcome-events).
