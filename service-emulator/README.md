# service-emulator

Read-only REST + webhook + MCP services over a persona-generator SQLite DB. The digest agent (or any consumer) talks to this — it never touches `persona.db` directly. All endpoints honor a synthetic-clock `as_of` filter so consumers see only the persona's past at any point in the 35-day window.

## What it does

Given a slug (e.g. `avery_chen`), reads `data/personas/<slug>/persona.db` and exposes:

- **REST** — mail / calendar / notes endpoints over HTTP
- **MCP** — same data via stdio MCP transport for production-shape agent consumption
- **Webhooks** — synthetic-clock replay that POSTs `email.delivered` / `note.created` / `calendar.op` events to a registered URL

The DB is the source of truth; this service renders canonical wire formats (RFC 822 for mail, iCalendar for calendar, markdown for notes) on the fly.

## Install + run

```bash
cd service-emulator
uv sync                                          # installs persona-generator as an editable workspace dep
uv run service-emulator serve avery_chen        # REST + OpenAPI docs on http://127.0.0.1:8000
```

Then:

```bash
curl 'http://127.0.0.1:8000/mail/messages?as_of=2026-05-13&limit=5'
curl 'http://127.0.0.1:8000/mail/messages/<message_id>'        # RFC 822 .eml
curl 'http://127.0.0.1:8000/calendar/events?as_of=2026-05-15T07:00:00-07:00'
curl 'http://127.0.0.1:8000/calendar/ics?as_of=2026-05-15' > calendar.ics
curl 'http://127.0.0.1:8000/notes' | jq .
```

OpenAPI auto-docs at `http://127.0.0.1:8000/docs`.

## CLI commands

```
service-emulator serve <slug>                    # REST server
service-emulator mcp <slug>                      # MCP server (stdio transport)
service-emulator replay <slug> --webhook-url URL # walk the synthetic window, fire events
service-emulator fire <slug> --webhook-url URL \
    --after-iso T1 --through-iso T2              # fire events in one slice (testing)
```

## REST endpoints

### Mail (`/mail/`)

| Endpoint | Returns |
|---|---|
| `GET /mail/messages?as_of=…&from_addr=…&to_addr=…&storyline=…&decoy=…&limit=N` | JSON list of message summaries (visible at as_of) |
| `GET /mail/messages/{message_id}?as_of=…` | RFC 822 `.eml` (404 if not yet sent at as_of) |
| `GET /mail/messages/{message_id}/attachments/{attachment_id}` | Raw attachment bytes with original MIME type |
| `GET /mail/threads/{thread_id}?as_of=…` | All messages in the thread |

### Calendar (`/calendar/`)

| Endpoint | Returns |
|---|---|
| `GET /calendar/events?as_of=…&include_cancelled=false` | JSON list of events — state computed by replaying `initial_calendar_events` + `calendar_ops` up to as_of |
| `GET /calendar/events/{event_id}?as_of=…` | Single event JSON |
| `GET /calendar/ics?as_of=…` | Full iCalendar `.ics` dump |
| `GET /calendar/ops?as_of=…&limit=N` | Raw op log for debugging |

### Notes (`/notes/`)

| Endpoint | Returns |
|---|---|
| `GET /notes?as_of=…&storyline=…&limit=N` | JSON list of note summaries |
| `GET /notes/{note_id}?format=markdown` | Markdown with X-Synth front matter (default) |
| `GET /notes/{note_id}?format=json` | JSON with body inline |

## MCP tools

When you run `service-emulator mcp <slug>`, the stdio MCP server exposes seven tools:

- `mail_search(as_of?, from_addr?, to_addr?, storyline?, decoy?, limit?)`
- `mail_get(message_id, as_of?)` → full RFC 822 body
- `mail_thread(thread_id, as_of?)`
- `calendar_list(as_of?, include_cancelled?)`
- `calendar_get(event_id, as_of?)`
- `notes_search(as_of?, storyline?, limit?)`
- `notes_get(note_id, as_of?)` → markdown body

Connect from any MCP-capable client (Claude Code, custom agents using `mcp` SDK, etc.).

## Webhooks

Two modes — both POST JSON to the webhook URL with `Content-Type: application/json` and (optional) `X-Webhook-Secret`:

**Replay**: walks the synthetic window at accelerated time.

```bash
service-emulator replay avery_chen \
    --webhook-url http://localhost:9999 \
    --speedup 3600                               # 1 hour synthetic per 1 real second
```

**Fire**: events in a specific time slice (no real-time wait — useful for testing).

```bash
service-emulator fire avery_chen \
    --webhook-url http://localhost:9999 \
    --after-iso "2026-04-23T23:59:59-07:00" \
    --through-iso "2026-04-24T23:59:59-07:00"
```

Event shape:

```json
{
  "type": "email.delivered",            // or note.created | calendar.op
  "ts_iso": "2026-04-24T07:42:00-07:00",
  "ref_id": "<d06-mary-q1@plumb.so>",
  "payload": {
    "message_id": "<d06-mary-q1@plumb.so>",
    "from": "mary@bessemer.com",
    "subject": "Q1 metrics",
    "thread_id": "...",
    "storyline_id": "series_a_raise",
    "is_decoy": false,
    "link": "/mail/messages/<d06-mary-q1@plumb.so>"
  }
}
```

Delivery uses `httpx` with exponential-backoff retry (3 attempts, base 1s).

## Synthetic clock

Every read accepts `?as_of=<ISO 8601>`. Three accepted shapes (all parsed by [`src/service_emulator/clock.py`](src/service_emulator/clock.py)):

- `2026-05-21` — interpreted as end-of-day Pacific (`2026-05-21T23:59:59-07:00`)
- `2026-05-21T07:00:00` — assumed Pacific
- `2026-05-21T07:00:00-07:00` — used as-is

Default if omitted: end of window (`2026-05-23T23:59:59-07:00`) — everything visible.

## Key files

- `src/service_emulator/cli.py` — Typer CLI (`serve`, `replay`, `fire`, `mcp`)
- `src/service_emulator/rest/app.py` — FastAPI app factory
- `src/service_emulator/rest/{mail,calendar,notes,webhooks}.py` — route modules
- `src/service_emulator/mcp/server.py` — MCP server + tool definitions
- `src/service_emulator/rendering/{eml,ics,notes}.py` — DB row → wire format
- `src/service_emulator/clock.py` — synthetic-clock parsing + filtering

## Tests

```bash
uv run pytest tests/unit/ -q                     # ~18 tests against fixture DB
```

Covers the synthetic clock parser, REST routes (mail / calendar / notes with as_of filtering and attachment fetch), and ICS / EML / markdown rendering.

## Architecture note

The emulator is **strict** about canonical key names in `calendar_ops.payload_json` (`start_iso` / `end_iso`, not short `start` / `end`). The persona-generator's Stage 7 tool also enforces this. No fallback parsing — if there's drift, the generator's tool fails fast and the prompt asks for a fix.
