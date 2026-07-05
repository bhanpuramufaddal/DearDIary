# Adapters — Two Interfaces to the World

The cognitive core touches the world through exactly **two interfaces**: events pushed in, MCP queries pulled out. This doc specifies the shape of both.

For the trial, the **first and only event-source adapter is `persona-emulator`**, paired with the sibling persona-generator project. Real-world adapters (Gmail, Slack, Google Calendar, Notion, Linear, GitHub) land later via the same interface; the trial doesn't gate on them.

## The two interfaces

**Event source interface — push only.** Sources that can push events to the webhook server, plus the agent's own reminder firings. Each event becomes a single mind-agent invocation. Adapters normalize source-specific payloads into one event schema. **If a source doesn't push, it is not an event source.** The digest doesn't poll. The digest doesn't watch. Either a source supports push (and gets an adapter) or it's accessible only via MCP queries the agent makes on demand.

**MCP server access — pull.** Anything the agent can query on demand. The persona-generator MCP server (for the trial); later, Gmail MCP, Calendar MCP, Slack MCP, Linear MCP, GitHub MCP, Notion MCP. The digest doesn't implement MCP plumbing — it configures which servers each agent role has access to, and Claude Code's standard MCP routing handles the rest. Process lifecycle is managed by the main process's MCP-lifecycle subsystem (see [11-backend-architecture.md](11-backend-architecture.md)).

The same product can present both interfaces. Persona-generator pushes synthetic events through its webhook and also exposes a `persona-emulator-mcp` server for queries. The two are independent: webhook events are the trigger, MCP is how the agent reads more. Real Gmail will follow the same shape: a webhook adapter for push notifications, a Gmail MCP server for historical queries.

Sources without push capability and without an MCP server are simply not connected. The principal can still keep external notes in any app they like — the digest just won't see them. To get content into the digest's awareness without a connector, the principal uses the diary view's bottom-of-page notes field (or `diary_add_note` from the MCP plugin) to add a note directly to the diary.

## The Markov-blanket discipline

The cognitive core — anchors, entities, predictions, agents, prompts — does not know what an `.eml` looks like, what an `iCalUID` is, or how a persona-emulator event is shaped. The mind agent reads events the dispatcher hands it. The diary lands as rows. External MCP servers are configured per role and called by their own schemas.

Three consequences:

1. **Source-specific parsing lives in event-source adapters.** Header parsing, attendee normalization, persona-generator payload mapping, name extraction — all in adapter code. The cognitive layer reads the normalized event.
2. **The cognitive core is testable without the world.** Fixtures replace event-source adapters in tests; external MCP servers can be stubbed at the process boundary.
3. **Adding a source is a local change.** A future Gmail / Slack / Linear / Notion adapter is a new module implementing the event-source contract, plus an MCP server entry in `config.jsonc`. The cognitive layer does not change.

## The single event schema

Every event-source adapter, regardless of source kind or implementation, produces events in **one normalized schema**. The cognitive core has exactly one event shape to reason about.

```json
{
  "id": "<stable, source-derived>",
  "source": "<free-form tag — e.g., inbox-gmail, calendar-google, slack-acme, reminder, diary_input>",
  "observed_at": "<ISO8601 — when the main process saw this>",
  "occurred_at": "<ISO8601 — when the event happened>",
  "identity_handles": ["<string>", "..."],
  "payload": { /* source-specific content, schema-bounded by source */ }
}
```

Every field is mandatory. `source` is a free-form tag — no hardcoded enum. `payload` is a per-source typed object; the cognitive core treats it as opaque content the agent reads, only the agent (LLM) interprets the payload semantically. Tool code never branches on `payload` shape.

`identity_handles` is the adapter's best effort to extract names, addresses, references, and other matching strings from the source-specific payload. It's a fast-path hint: the mind agent uses it to scan candidate anchors and entities quickly. The agent always reads the full payload and may match additional handles the adapter missed (e.g., a name mentioned in an email body that wasn't in any header).

Notice: there is **no `processed` flag**. Events are one-shot triggers, not queue entries. The mind dispatcher consumes each event off the bus exactly once (durable subscriber, cursor in `event_subscriber_cursors`) and the substrate is the durable memory.

## Event-source adapter patterns

Two patterns:

| Pattern | Examples | How it works |
|---|---|---|
| Webhook | persona-emulator (trial); later Gmail, Google Calendar, Slack, Linear, GitHub | Source POSTs to the webhook server's HTTP endpoint (loopback-bound, exposed to the public internet via the ngrok tunnel) |
| Reminder timer | Agent's own `set_reminder` | Reminder scheduler reads the `reminders` table and emits `reminder.fired` at the right time |

Both produce the same event schema. The cognitive core sees no difference.

Filesystem watchers and snapshot pollers are deliberately not in this list — they're aspirational additions for a future expansion (local notes, Obsidian, etc.) but not part of the trial design. The digest only observes what pushes.

## Webhook adapters

The main process hosts a Fastify HTTP server bound to loopback (see [08-runtime.md](08-runtime.md), [11-backend-architecture.md](11-backend-architecture.md)). The ngrok tunnel manager exposes it publicly. Each webhook adapter registers a route the provider POSTs to.

### Persona-emulator webhook (MVP — the trial source)

**Endpoint:** `POST /webhook/persona-emulator`

**Authentication:** shared secret in `Authorization` header; `webhook.persona_emulator.secret` in config.

**Body:** persona-generator's emitted event. The persona-emulator's contract (event payload shape, identity-handle extraction) lives in the persona-generator project. The adapter on our side normalizes that into the single event schema.

**Adapter responsibility:**

1. Authenticate the request.
2. Map the persona-emulator payload into a normalized event envelope (e.g., a persona-generator email artifact maps into a payload that looks structurally like the Gmail webhook payload below — same fields, persona-source IDs).
3. Compute the stable ID (e.g., `persona:<persona-slug>:email:<msg_id>`).
4. Build the event.
5. Hand it to the webhook server, which emits `webhook.persona-emulator` on the bus.

This adapter is the trial source. Mind-agent invocations on persona-emulator events look the same as they would on real Gmail / Calendar events.

### Inbox webhook (Gmail example — later)

**Endpoint:** `POST /webhook/inbox-gmail`

**Authentication:** shared secret in `Authorization` header; `webhook.inbox_gmail.secret` in config.

**Body:** Gmail push notifications carry the message ID; the adapter then calls Gmail (via MCP or REST) to fetch the body.

**Adapter responsibility:**

1. Authenticate the request.
2. Resolve the source-specific identifiers to a normalized envelope (subject, body, headers, addresses, threading).
3. Compute the stable ID.
4. Build the event.
5. Hand it to the webhook server, which emits `webhook.gmail` on the bus (mind dispatcher subscribes).

```json
{
  "id": "gmail:msg_4f2a8c",
  "source": "inbox-gmail",
  "observed_at": "2026-05-23T07:04:22-07:00",
  "occurred_at": "2026-05-23T07:04:00-07:00",
  "identity_handles": ["Renee Tan", "renee.tan@halberd.com", "Halberd"],
  "payload": {
    "message_id": "msg_4f2a8c",
    "from": "Renee Tan <renee.tan@halberd.com>",
    "to": ["avery@tessera.ai"],
    "cc": [],
    "subject": "May 28 rollout — go/no-go",
    "body": "Avery — internal stakeholder meeting is tomorrow ...",
    "in_reply_to": null,
    "references": [],
    "thread_id": "thread_4f2a"
  }
}
```

The `id` (`gmail:msg_4f2a8c`) is what an anchor's `case_base` will cite. If the agent wants to revisit the message body later, it calls Gmail MCP with `message_id=msg_4f2a8c`. No copy lives in the digest substrate.

### Calendar webhook (Google example)

**Endpoint:** `POST /webhook/calendar-google`

**Authentication:** shared secret; `webhook.calendar_google.secret`.

**Body:** Google Calendar push notification, ics push, or trial emulator op.

**Adapter responsibility:** same five steps as inbox. Output:

```json
{
  "id": "gcal:ics_evt_a91c:2026-05-29T14:00:00-07:00",
  "source": "calendar-google",
  "observed_at": "2026-05-22T21:04:00-07:00",
  "occurred_at": "2026-05-29T14:00:00-07:00",
  "identity_handles": ["Northstar Partners", "Sam Chen"],
  "payload": {
    "uid": "ics_evt_a91c",
    "recurrence_id": "2026-05-29T14:00:00-07:00",
    "summary": "Northstar quarterly sync",
    "start": "2026-05-29T14:00:00-07:00",
    "end":   "2026-05-29T15:00:00-07:00",
    "location": "Zoom",
    "attendees": [
      {"name": "Avery Chen", "address": "avery@tessera.ai", "response_status": "needsAction"},
      {"name": "Bria Northstar", "address": "bria@northstarfoods.com", "response_status": "accepted"}
    ],
    "organizer": {"name": "Bria Northstar", "address": "bria@northstarfoods.com"},
    "status": "CONFIRMED",
    "description": "Quarterly review of pipeline health and roadmap.",
    "is_recurring_occurrence": true,
    "op_kind": "created"
  }
}
```

`op_kind` distinguishes `created | updated | declined | accepted | cancelled`. A cancelled occurrence emits its own event.

## Reminder firings

When the reminder scheduler reaches a reminder's `fires_at`, it builds an event and emits `reminder.fired`:

```json
{
  "id": "reminder:rem_3f1a",
  "source": "reminder",
  "observed_at": "2026-05-26T09:00:00-07:00",
  "occurred_at": "2026-05-26T09:00:00-07:00",
  "identity_handles": [],
  "payload": {
    "reminder_id": "rem_3f1a",
    "context": "Check back on Halberd rollout — Renee said they'd confirm by today",
    "related_anchors": ["renee_tan", "halberd"]
  }
}
```

The reminder file is deleted after firing; the event exists once, processed once. If the agent wants to revisit the context, the substrate (anchors, predictions touched at set-time) carries the trail.

## Stable ID strategy per source

Events deduplicate by `id`. An adapter that re-reads its source must produce the same `id` for the same logical artifact. The webhook server maintains a small in-memory cache of recent IDs (no payloads); duplicates within the window are dropped before they reach the bus.

### Inbox (Gmail, RFC-822)

Use the Gmail `message_id`. Format:

```
gmail:<message_id>
```

Fallback when `Message-Id` is missing or malformed:

```
gmail:<sha256(date + from + subject + body[:512])[:16]>
```

### Calendar (Google, iCal)

Use `iCalUID` plus `RECURRENCE-ID` for recurring instances:

```
gcal:<UID>:<RECURRENCE-ID>
```

A moved occurrence carries a different `RECURRENCE-ID` and produces a new event; the original is referenced from anchors by its original id.

### Slack

```
slack:<channel_id>:<message_ts>
```

### Linear / Jira / Asana

```
linear:<issue_id>:<sha256(body)[:8]>
```

### Diary comments and notes (internal)

The MCP tools `diary_add_comment` and `diary_add_note` mint events with deterministic ids:

```
diary_comment:<diary_date>:<component_id>:<created_at>
diary_note:<diary_date>:<created_at>
```

The same `created_at` is guaranteed by the tool's atomic write; duplicates are impossible.

### Reminders (internal)

```
reminder:<reminder_id>
```

## Case base cites source IDs

This is the heart of the no-stream design. When the agent updates an anchor with new evidence, the `case_base` entry is a source ID like `gmail:msg_abc123` or `gcal:event_xyz`. To revisit the evidence later, the agent calls the corresponding MCP server with that ID:

- `gmail:msg_abc123` → agent calls Gmail MCP's `get_message(message_id="msg_abc123")`
- `gcal:event_xyz` → agent calls Google Calendar MCP's `get_event(event_id="event_xyz")`
- `notion:page_456` → agent calls Notion MCP's `get_page(page_id="page_456")`

The source is the canonical record. The digest doesn't shadow-copy email bodies, calendar payloads, or note contents into its substrate — it cites and queries.

## Identity-handle extraction

The adapter is the only place source-specific identity extraction lives.

- **Inbox** — `From:` (display name + address), `To:` and `Cc:` recipients, body name tokens (mentions of "Marcus", "Jordan"); thread `references` for continuity.
- **Calendar** — organizer name and address; every attendee name and address; tokens parsed from `SUMMARY` and `LOCATION`.
- **Notes** — title from frontmatter or first `H1`; frontmatter fields `attendees`, `participants`, `people`, `mentions`, `project`; body `@mentions` and explicit name tokens.
- **Slack** — sender display name and user id; mentions in message body.

When unsure, err toward inclusion. False-positive handles activate too many anchors when the mind agent reads — cheap. False-negative handles miss real activations; matters fall off the agent's radar — expensive.

The agents consume `identity_handles` as opaque strings and treat them as hints. The matching is done by the agent reading the handle against the anchor or entity's slow layer — not by string compare.

## MCP server access

The other interface. The main process configures which MCP servers each agent role has access to, via `config.jsonc`:

```jsonc
{
  "mcp_servers": {
    "gmail":  { "command": "uvx gmail-mcp",  "env": { "GMAIL_TOKEN":      "${GMAIL_TOKEN}" } },
    "gcal":   { "command": "uvx gcal-mcp",   "env": { "GCAL_CREDS_FILE":  "~/.config/gcal/creds.json" } },
    "notion": { "command": "uvx notion-mcp", "env": { "NOTION_API_KEY":   "${NOTION_API_KEY}" } },
    "slack":  { "command": "uvx slack-mcp",  "env": { "SLACK_TOKEN":      "${SLACK_TOKEN}" } }
  },
  "agents": {
    "mind":       { "mcp_servers": ["gmail", "gcal", "notion", "slack"] },
    "diary":      { "mcp_servers": ["gmail", "gcal", "notion", "slack"] },
    "cold_start": { "mcp_servers": [] }
  }
}
```

The Claude Code CLI provides MCP server discovery and invocation natively. We don't implement `list_mcp_servers`, `list_mcp_tools`, `call_mcp` — those would be re-implementations of plumbing the CLI already has. When a dispatcher spawns an agent subprocess, it passes `--mcp-config` listing the role's MCP server set, and Claude Code exposes those servers' tools to the LLM loop.

The digest's job for MCP is configuration, not implementation.

## Where the event-source adapters live

```
src/main/webhook/
├── server.ts                 # Fastify routes /webhook/<id>
├── tunnel.ts                 # ngrok subprocess supervisor
└── adapters/
    ├── persona-emulator.ts   # MVP — the trial source
    ├── gmail.ts              # later
    ├── gcal.ts               # later
    └── ...                   # later
```

The webhook server (see [08-runtime.md](08-runtime.md)) imports and wires them. The webhook server is owned by the main process. Adapters do not own their own runtime — they are pure functions from inbound HTTP payload to normalized event.

## How to add a source

The contract: implement the event-source adapter, expose an MCP server, or both.

1. **Does the provider push?** If yes, write a webhook adapter (`src/main/webhook/adapters/<name>.ts`). If no, the source is not an event source — but it can still be useful as an MCP server the agent queries on demand.
2. **Choose a `source` tag.** Free-form. Convention: `<kind>-<implementation>` — `inbox-outlook`, `calendar-fastmail`, `tasks-linear`, `messages-discord`. The cognitive layer doesn't enumerate these; it treats them as opaque tags.
3. **Implement the stable-ID strategy.** Native identifiers preferred (provider message ids, page ids, message ts). Content-hash fallback when no native id exists. Document the choice.
4. **Implement identity-handle extraction.** Pull names, addresses, project codes — anything an agent might use as a hint.
5. **Wire into the webhook server.** Register a `POST /webhook/<source-id>` route; the route emits `webhook.<source-kind>` on the event bus when an event arrives.
6. **Expose the MCP server.** If the source also has a queryable API, add it under `mcp_servers` in config and grant agent roles access via `agent_mcp_access`. Claude Code's standard MCP routing handles the rest.
7. **Configure in `config.jsonc`.** See [10-config.md](10-config.md).

No agent prompt changes. No anchor or entity schema changes. The Markov-blanket discipline holds.

Likely future sources:

- **Slack** → webhook (Events API) + Slack MCP for queries.
- **Linear / Asana / Jira** → webhook for issue updates + their MCP for queries.
- **Notion comments** → webhook (Notion notifications) + Notion MCP for the page.
- **GitHub** → webhook for PR/issue events + GitHub MCP.

Sources that don't push (Apple Mail / IMAP, local filesystem notes, etc.) are aspirational — they could be added later via filesystem watchers or polling, but the trial design does not include those mechanisms.

## The output adapter

One output: the diary. The diary agent does not write a JSON file — it builds the day's diary one component at a time through the per-template `write_<template>` substrate tools (one per HITL template), each persisting a `diary_components` row (with its anchor refs) after validating the content against the template's registry schema. The on-the-wire JSON document is *assembled on read* from those rows (`assembleDiary(date)`), served by the surface MCP's `digest_get` and the renderer's diary view. See [11-backend-architecture.md](11-backend-architecture.md#diary-assembly) and [02-diary-model.md](02-diary-model.md).

Yesterday's diary is never rewritten; a recompose clears and rebuilds only today's rows (`clear_diary(today)` then the `write_<template>` calls).

Other writes inside the core (anchor / entity updates, reminder mints) are internal state, not "output" in the Markov-blanket sense. The assembled diary is the only thing that crosses outward. The principal sees it (via Claude Code's A2UI renderer or `digest get`); the calling agent dispatches from it. The world is the record of action; the next event observes the consequences.

## Deletion handling

If a source artifact is deleted — email archived, event removed, note deleted — the source itself records that change, and the next time the agent queries via MCP it'll see the current state. The anchor's `case_base` still cites the original source ID; an MCP lookup returns "not found" or "archived," which the agent reads as evidence of the principal's handling.

Cleanup is the principal's prerogative at the source. The digest doesn't try to mirror source state — it cites source IDs and queries when needed.
