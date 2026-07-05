# Execution Surfaces

Two surfaces: CLI and MCP plugin. Both serve the same artifact — the diary JSON. The diary is the [sole contract](00-architecture-overview.md); the surfaces serve it.

See `diagrams/execution-surfaces.excalidraw` for the topology.

## The diary as the central artifact

The diary is a JSON file at `~/digest/diary/YYYY-MM-DD.json`. Structured components in four sections (Right Now, On the Desk, Tracking, Background), a bottom-of-diary notes section, a thinking-layer journal. See [02-diary-model.md](02-diary-model.md) for the full schema.

Every surface reads and writes the same file. The MCP tools wrap JSON I/O with mind-agent invocation; the CLI is human-facing reads and management commands; Claude Code is the canonical renderer.

## How events flow

Sources are the source of truth. The cognitive substrate (anchors, entities, predictions, reminders) is the agent's processed understanding of them.

1. An event source (Gmail webhook, Calendar webhook, future Slack / Linear webhooks, etc.) pushes an event to the daemon's HTTP webhook server. Reminders the agent has scheduled fire as internal events.
2. The daemon dedups against an in-memory cache and invokes the **mind agent** with the event payload as direct input.
3. The mind agent decides which anchors and entities are activated, updates layers, supports / contradicts / deletes predictions, creates entities and anchors as needed, promotes entities whose evidence has accumulated, sets reminders, and exits.
4. On schedule or on demand, the daemon invokes the **diary agent**. The daemon serializes invocations so all received events are processed by the mind agent before composition starts (the always-fresh guarantee).
5. The diary agent reads anchors, entities, plays, profile, prior diaries; composes today's diary JSON; emits efference-copy predictions on dispatchable components. It does not change the substrate — promotion observations are flagged in the day's thinking layer for the next mind invocation.

The agent queries source content through SDK-native **MCP server access** when it needs to revisit evidence — re-read Marcus's last 10 emails, look up a calendar entry's history, walk a note's revisions. Source IDs in the `case_base` (`gmail:<msg-id>`, `gcal:<uid>`, `slack:<ts>`, `notion:<page-id>`) point back to the canonical record. The digest doesn't shadow-copy source content.

## The CLI surface

The `digest` binary is the human-and-script entry point. Every command corresponds to one operation in the runtime; no orchestration logic lives in the wrapper.

### Commands

**`digest run`** — invokes the diary agent. The daemon ensures any pending mind-agent invocations finish first (always-fresh), then composes today's diary. Prints the path on success. Exits non-zero on failure with errors to stderr and `~/digest/logs/`.

```
$ digest run
~/digest/diary/2026-05-25.json
```

With `--print`, the diary is also rendered to stdout (textual view, see "Rendering" below) after the path.

**`digest get`** — prints the latest diary to stdout in textual form. Fires no agent. `--date YYYY-MM-DD` prints that day's. `--json` emits the raw JSON instead of the textual view. Exits non-zero if no diary exists for the requested date.

```
$ digest get
Daily Digest — Sunday, May 24, 2026

[Right Now]
...
```

**`digest init`** — first-run interactive setup. Walks through timezone, event sources, MCP servers, diary schedule, optional `profile.md` scaffold; writes `~/digest/config.jsonc`; invokes the cold-start agent (seeds `_principal.json` from `profile.md` — nothing else); writes the daemon launch entry. Day 1 starts with one anchor; events arrive through normal flow once the daemon is running. No backfill. No historical mass import. See [10-config.md](10-config.md) for the interactive flow and [03-cycle.md](03-cycle.md) for the cold-start agent.

**`digest config`** — manages `config.jsonc` after setup. Subcommands cover common operations:

- `digest config show` — print effective config (yours plus defaults).
- `digest config edit` — open `config.jsonc` in `$EDITOR`.
- `digest config schedule | event-sources | mcp-servers | timezone | model | webhook` — focused interactive prompts.
- `digest config set <path> <value>` / `digest config unset <path>` — one-shot programmatic edits.
- `digest config validate` — check paths exist, timezone parses, times are well-formed, webhook URL is reachable, MCP server commands resolve.

See [10-config.md](10-config.md) for the full subcommand list and examples.

**`digest tick`** — debug-only. Fires a single mind-agent invocation manually against a payload supplied on stdin or via `--event <file>`. Useful for prompt iteration without waiting for a real event. Produces no diary; updates anchors, entities, predictions, reminders. Rarely needed; the daemon dispatches the mind agent automatically as events arrive (see [08-runtime.md](08-runtime.md)).

**`digest inspect <id>`** — renders an anchor's or entity's JSON as readable prose to stdout. Escape hatch for inspecting cognitive state without grepping JSON. Not part of the diary contract; intended for development. `digest inspect _principal` renders the principal-anchor.

### Standard flags

These apply to every command unless noted.

- `--config <path>` — override path to `config.jsonc`. Default: `~/digest/config.jsonc`. Profile is always read from the `digest_dir` resolved out of config.jsonc.
- `--customize <prompt.md>` — load an additional markdown file as a per-invocation prompt **overlay** (added to, not replacing, the disposition). See [06-profile-schema.md](06-profile-schema.md).
- `--dry-run` — compose in memory, print to stdout without writing or updating cognitive state. Useful for evaluating prompt changes without polluting the substrate.

### What the CLI is and is not

The CLI is for humans and scripts. The MCP plugin is for Claude Code sessions. The two share the underlying runtime; the choice is about who is calling.

The CLI does not expose execution. It does not send emails, accept meetings, or modify notes. `digest run` produces a diary; the principal (or a calling agent reading the diary) acts on what it surfaces.

## The MCP plugin surface

The tool ships as a Claude Code plugin exposing **five tools**: `digest_run`, `digest_get`, `diary_act`, `diary_add_comment`, `diary_add_note`. No anchor-inspection endpoint. No event-query endpoint.

The first two read and produce diaries. The last three are write-backs from the calling agent and from the principal. The calling agent (Claude Code) has its own ambient access to source MCP servers — it doesn't need the digest to relay events.

### `digest_run`

```
digest_run(force: bool = false) -> {
  diary_path: str,
  diary_json: object,
  summary: str,
}
```

Invokes the diary agent (with the daemon's always-fresh guarantee in front of it). Returns the path of the new diary, the diary JSON, and a one-paragraph summary suitable for inlining into a Claude Code conversation header.

The `force` parameter governs caching. If a diary tick fired within the last N minutes (configurable via `mcp.cache_ttl_minutes` in `config.jsonc`, default 5), `digest_run` returns the cached recent diary without firing a new tick. This prevents an interactive Claude Code session from spawning redundant invocations when the principal invokes `/digest` repeatedly. Pass `force=true` to bypass.

### `digest_get`

```
digest_get(date: str | null = null) -> {
  diary_path: str,
  diary_json: object,
}
```

Returns a diary from disk as JSON. Fires no agent. With `date` omitted, returns the latest diary. With `date` set to `YYYY-MM-DD`, returns that day's. Errors if no diary exists for the requested date.

### `diary_act`

```
diary_act(
  component_id: str,
  action_kind: str,             # e.g. "send", "accept", "decline", "apply"
  result_payload: object,       # source-of-truth data from the calling agent
) -> { ok: bool, component_status: str }
```

Called by the calling agent after it executes a component's affordance. The digest agent:

1. Looks up the component by `component_id` in today's diary JSON.
2. Updates its `status` (typically `open` → `acted`).
3. Appends a `dispatched_at` timestamp and the `result_payload` (e.g., the actual `Message-Id` of the sent email, the actual calendar event response).
4. Invokes the mind agent with the dispatched-action event so it can correlate to the existing efference-copy prediction.

The contract: the calling agent's action is what touched the world; `diary_act` is the agent telling the digest "I did this." The digest never executes on the world.

### `diary_add_comment`

```
diary_add_comment(
  component_id: str,
  text: str,                    # principal-authored, free prose
) -> { ok: bool }
```

Principal-authored comment attached to a specific component. Triggered by an explicit UI affordance in the rendered diary (button or enter-key in the A2UI comment field). The digest agent:

1. Appends `{author: "principal", text, at}` to the component's `comments` array.
2. Invokes the mind agent with the comment as the event payload, referencing the component and its `anchor_refs`.

Principal commentary is observation — it can update anchors, contradict predictions, or just sit in the case base.

### `diary_add_note`

```
diary_add_note(text: str) -> { ok: bool }
```

Principal-authored note at the bottom of the diary. Same submission shape as a comment but unattached to any component. The digest agent:

1. Appends `{text, at}` to the diary's bottom-of-diary `notes` array.
2. Invokes the mind agent with the note as the event payload.

Bottom-notes are the principal's scratch surface inside the diary — anything that didn't fit a component's comment, anything they want to leave for tomorrow's diary to pick up, anything they want the mind agent to ingest as a free-form observation.

### Why these five and not more

Execution remains the calling agent's competency — Claude Code already has Gmail, Calendar, file editing, Bash, web fetching tools. The digest does not re-implement those wrappers.

The five tools cover:

- **Read the diary** (`digest_get`) and **produce a new one** (`digest_run`).
- **Tell the digest that an action ran** (`diary_act`) so the efference loop closes precisely without waiting for sensory observation.
- **Tell the digest what the principal said** (`diary_add_comment`, `diary_add_note`) so the principal's words enter the cognitive substrate like any other observation.

No anchor-inspection tool. If a piece of context about Marcus Webb matters to the caller, it should be in the diary entry that mentions Marcus — in the component, in the comments, or in the thinking layer. If it isn't, the diary tick failed; the fix is in the agent prompt, not in a new API endpoint.

Letting callers reach past the diary into anchor JSON would invite drift: callers depend on internal state, the diary's role as contract erodes, the cognitive layer loses freedom to refactor anchor and entity shape.

Direct file reads of `~/digest/anchors/*.json` and `~/digest/entities/*.json` remain available for debugging (and `digest inspect` renders them to prose), but those are not API-sanctioned operations.

## Rendering

The diary is JSON. Three renderers consume it.

**Claude Code (primary).** Claude Code receives the JSON from `digest_run` or `digest_get` and renders A2UI components inline in the conversation. Each component type has a native widget: `email-draft` shows the drafted reply with Send / Edit / Discard buttons; `calendar-block` shows the event with Accept / Decline / Propose; `choose-one` shows the options as a single-select; `free-text-reply` shows a text field with Send. Comments and bottom-notes each have a submit affordance that calls `diary_add_comment` or `diary_add_note`.

When the principal clicks Send on an `email-draft`, Claude Code uses its Gmail tool to send the email, then calls `diary_act(component_id, "send", {...})` so the digest records the dispatch.

**CLI (read-only).** `digest get` prints a textual view. No affordances; the principal acts elsewhere. The CLI rendering is the same JSON serialized to readable prose, useful for shell users, scripts, log inspection, or terminal-first principals.

**Web / TUI (future, out of scope).** Other surfaces are anticipated. Each consumes the same diary JSON; the digest itself doesn't change. The JSON is the contract — anything that can render the four sections and the component types is a valid surface.

## The feedback loop

Two paths close the loop, not one.

**Through `diary_act` (precise).** When Claude Code sends the email and immediately calls `diary_act`, the component flips to `acted`, the mind agent runs against the dispatched-action event, and the efference prediction resolves quickly.

**Through observation (canonical).** When the email lands in Sent, the inbox webhook fires; the mind agent processes the new event the same way it processes inbound mail; the relevant anchor's fast layer absorbs the observation; the efference prediction resolves.

The two paths agree in the common case; they're independently robust:

- A calling agent that ignores `diary_act` is not a failure mode — the world is still the record. The next mind invocation observes that the email was sent, the meeting accepted, the task done — the anchor still updates and the efference prediction still resolves.
- A calling agent that calls `diary_act` for an action it didn't actually execute leaves a discrepancy that surfaces when sensory observation contradicts. The agent prefers observation when the two disagree.

The tool is robust to calling-agent failure because it never relied on calling-agent confirmation alone.

## Diary components and affordances

Each component carries a `type` and an `actions` array. The renderer maps these to widgets and the calling agent maps them to native tools. See [02-diary-model.md](02-diary-model.md) for the full component schema, but a brief example:

```json
{
  "id": "comp_20260524_0647_001",
  "type": "email-draft",
  "section": "on_the_desk",
  "anchor_refs": ["renee_tan", "halberd_manufacturing"],
  "content": {
    "to": "renee.tan@halberd.com",
    "subject": "Re: May 28 rollout — go/no-go",
    "body": "yes, may 28 still on. jordan confirmed eng is on track tuesday.\nwe'll flag if anything changes before then.\navery",
    "in_reply_to": "gmail:msg_174bb8"
  },
  "actions": ["send", "edit", "discard"],
  "status": "open",
  "comments": [],
  "efference_prediction": {
    "claim": "Renee responds within 24h, positive acknowledgment",
    "expected_by": "2026-05-25T14:00-08:00",
    "kind": "event",
    "precision": 0.8
  }
}
```

Components are JSON objects — no embedded YAML, no markdown fences, no in-prose serialization. The calling agent reads the field; it doesn't parse a fence. Renderers handle the markdown.

## The Claude Code slash command

When the MCP plugin is installed, `/digest` is available in any Claude Code conversation. The command calls `digest_run` (cache honored), receives the JSON, and renders A2UI components inline. The calling Claude then reasons about the diary alongside whatever the principal was working on and offers — using its own tools and the `diary_act` tool to close the loop — to act on components the principal selects.

Intended shape: principal opens Claude Code in the morning, types `/digest`, sees the day's diary rendered in the conversation, says "yes, send the Marcus email and accept the Lumen meeting." Claude executes both using Gmail and Calendar, then calls `diary_act` twice. The principal's later comments and bottom-notes go through `diary_add_comment` and `diary_add_note`. The mind agent processes each as an event.

## `digest run` vs `digest_run`

Same verb on both surfaces with parallel semantics. The distinction is who is calling:

- `digest run` (CLI) — invoked by the principal or by the daemon's diary scheduler. Returns the path; doesn't render the JSON.
- `digest_run` (MCP) — invoked by a Claude Code session that wants the diary inlined as A2UI, with caching so repeated invocations within minutes return the same artifact.
- `digest get` (CLI) — prints a textual view of the diary JSON.
- `digest_get` (MCP) — returns the same JSON for Claude Code to render.

Beyond who is calling, the verbs are semantically identical. The diary file is the same artifact.

## Operational logs

A separate `~/digest/logs/` directory holds standard application logs: agent-invocation start/end timestamps, errors, retry counts, LLM-call latencies, webhook delivery durations, dedup-cache hits.

```
~/digest/logs/
├── 2026-05-25.log
└── ...
```

One log file per day, line-oriented, plain text. **Not part of the cognitive substrate** — not anchor content, not entity content, not diary material. The cognitive layer never reads them. Logs are operational telemetry for operators (principal, monitoring script, human) to observe runtime health.

When a mind invocation fails because the LLM API is unreachable, the failure lands here. When a diary invocation takes 47 seconds, the timing lands here. When `digest_run` returns a cached diary from MCP, the cache hit lands here. When the inbox webhook fires, the receipt lands here.
