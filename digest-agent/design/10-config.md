# Config & Setup

This doc specifies `config.jsonc` — the tool's operational settings — and the interactive flows (`digest init`, `digest config`) that manage it.

`config.jsonc` is the companion to `profile.md`:

| File | Holds | Authored by | Format |
|---|---|---|---|
| `profile.md` | Principal voice, identity, who matters, suppression, tone | the principal (prose) | freeform markdown |
| `config.jsonc` | Timezone, schedule, event sources, MCP servers, webhook URL, model selection | interactive setup or hand-edit | JSON with comments |

`profile.md` is interpreted by the agent as prose. `config.jsonc` is parsed by the runtime as code. Mixing them creates a fragile editing surface for both. Keep them separate. See [06-profile-schema.md](06-profile-schema.md) for the profile side.

**Why JSONC, not plain JSON.** `config.jsonc` benefits from inline annotations — what a field does, what the default is, when to use it. Plain JSON would force those notes into surrounding prose, hurting the at-the-file editing experience. JSONC is JSON with `//` and `/* */` comments; the runtime strips comments before structural validation. The rest of the substrate (anchors, entities, reminders) stays plain JSON — those are machine-written and don't benefit from comments.

## File location

```
~/digest/
├── profile.md       # principal-authored prose
├── config.jsonc     # operational settings (JSON with comments)
├── disposition.md   # ships with the tool
├── digest.db        # SQLite: cognitive substrate + bus audit log
├── plays/           # cognitive precedent library; ships with tool
└── logs/            # operational logs (agent timing, errors, webhook receipts)
```

The cognitive substrate — anchors, entities, relationships, predictions, case-base entries, reminders, diary days/components/comments/notes/thinking entries, and the bus's `events` audit log — all live as rows in `digest.db`. Filesystem retains only prose authored by the principal or shipped with the tool. See [11-backend-architecture.md](11-backend-architecture.md) for the full schema.

By default everything lives under `~/digest/`. The `--config <path>` flag (CLI / Settings window override) can point at an alternate `config.jsonc` for testing or multi-profile setups.

## Schema

```jsonc
// ~/digest/config.jsonc

{
  // IANA timezone. All schedules and "today" semantics resolve here.
  // Default: system timezone at install time.
  "timezone": "America/Los_Angeles",

  // Where the tool keeps its state. All paths below resolve relative to
  // this unless absolute. Default: ~/digest
  "digest_dir": "~/digest",

  // Event sources — anything that pushes events into the main process.
  // Free-form list. The `id` is the source's stable tag (used as a route
  // prefix and a dedup namespace). The `kind` selects the adapter
  // implementation. Each adapter consumes its own block of provider-
  // specific config.
  "event_sources": [
    {
      "id": "inbox-gmail",
      "kind": "gmail-webhook",
      "account": "avery@tessera.com"
      // OAuth credentials referenced; see adapter docs
    },
    {
      "id": "calendar-google",
      "kind": "google-calendar-webhook",
      "calendar_id": "primary"
    }
    // Future webhook-capable sources go here (Slack, Linear, GitHub).
    // Sources that don't push (e.g. local notes, IMAP) are not event sources
    // in this design — see 04-adapters.md.
  ],

  // MCP servers — long-lived servers the main process starts and exposes to
  // agent sessions via SDK-native discovery. Free-form list.
  "mcp_servers": [
    { "id": "gmail-mcp", "command": "uvx gmail-mcp --account avery@tessera.com" },
    { "id": "gcal-mcp",  "command": "uvx gcal-mcp --calendar primary" }
  ],

  // Which MCP servers each agent role may access. Subset of mcp_servers
  // above, by id. The cold-start agent has none — it only seeds the
  // principal-anchor from profile.md.
  "agent_mcp_access": {
    "mind":       ["gmail-mcp", "gcal-mcp"],
    "diary":      ["gmail-mcp", "gcal-mcp"],
    "cold_start": []
  },

  // Webhook server. The daemon binds an HTTP server at bind_host:bind_port
  // (loopback by default) and routes inbound POSTs to event-source adapters.
  // public_url is what providers (Gmail, Calendar) register; it's the URL
  // the tunnel exposes, not the bind address.
  "webhook": {
    "public_url": "https://digest-avery.ngrok-free.app/webhook",
    "bind_host":  "127.0.0.1",
    "bind_port":  8731,

    // Tunnel that exposes bind_host:bind_port to the public internet.
    // The daemon spawns and manages this subprocess as part of its lifecycle.
    // Set kind to "external" if you run your own tunnel (Cloudflare Tunnel,
    // Tailscale Funnel, reverse proxy, etc.) and only want the main process to
    // bind locally.
    "tunnel": {
      "kind": "ngrok",                       // "ngrok" | "external"
      "authtoken_env": "NGROK_AUTHTOKEN",    // env var holding the ngrok token
      "domain": "digest-avery.ngrok-free.app" // optional; reserved domain (free tier allows one)
                                              // omit for a random URL per restart
    }
  },

  // Diary schedule. Times in the principal's timezone. Each fires the
  // diary agent (with the main process's always-fresh guarantee in front).
  // Default: ["06:00"] — once per morning.
  "schedule": {
    "diary_times": ["06:00", "12:30", "21:00"]
  },

  // Claude Code CLI used to spawn every agent loop (mind, diary,
  // cold-start, execution). All invocations run permissionless via
  // --dangerously-skip-permissions.
  "claude_code": {
    // Path to the `claude` executable. Defaults to "claude" on PATH.
    "executable": "claude",
    // Optional per-role overrides (e.g., custom flags for execution
    // instances). Usually omitted.
    "extra_flags": []
  },

  // LLM selection per agent. Lets the principal trade cost against
  // quality. Defaults shown.
  "model": {
    "mind_agent":       "claude-sonnet-4-6",
    "diary_agent":      "claude-opus-4-7",
    "cold_start_agent": "claude-opus-4-7",
    "execution_agent":  "claude-sonnet-4-6"
  },

  // Anthropic API key. May be set here or via ANTHROPIC_API_KEY.
  // If both set, env var wins. The Claude Code CLI reads it the same way.
  "api_key_env": "ANTHROPIC_API_KEY",

  // MCP plugin behavior.
  "mcp": {
    // `digest_run` returns cached diary if last firing was within this
    // window. Use force=true to bypass. Set to 0 to disable caching.
    "cache_ttl_minutes": 5
  },

  // Operational logs (agent timing, errors, webhook receipts).
  // Separate from the cognitive substrate.
  "log_dir": "~/digest/logs"
}
```

Every field has a default. A `config.jsonc` containing only `event_sources` and `webhook.public_url` is the minimum viable configuration; everything else falls back. `digest config show` renders the effective config (yours + defaults).

Notice what's gone from earlier drafts: no `backfill_history_days`, no global `snapshot.poll_minutes`, no `sources:` enum. `event_sources` is open-ended; new source kinds (Slack, Linear, GitHub) add adapters without schema changes.

## Precedence

When the same setting is specified in multiple places, later wins:

1. **Built-in defaults**
2. **`config.jsonc`**
3. **Environment variables** (e.g., `ANTHROPIC_API_KEY`, `DIGEST_TIMEZONE`, `DIGEST_WEBHOOK_PUBLIC_URL`)
4. **CLI flags** (e.g., `--config <path>`, `--customize <prompt>`)

A one-shot `digest run --customize=focus-on-hiring.md` uses the customization overlay for that invocation only, without touching `config.jsonc`.

## Interactive flows

Two CLI commands manage `config.jsonc`. Both are conversational.

### `digest init` — first-run setup

Runs once per install. Detects whether `~/digest/` exists; if not, creates it and walks through setup:

```
$ digest init

Welcome to Daily Digest. Let's set things up.

[1/5]  Timezone
       Your system timezone is America/Los_Angeles. Use this? (Y/n)
       > Y

[2/5]  Event sources — anything that pushes events to the main process.

       Add a Gmail inbox? (Y/n)
       > Y
       Account: avery@tessera.com   [OAuth flow opens in browser]
       Source id: [inbox-gmail]

       Add a Google Calendar? (Y/n)
       > Y
       Calendar id: primary
       Source id: [calendar-google]

       Add a notes source? (filesystem | notion | obsidian | skip)
       > filesystem
       Path: ~/Documents/notes
       Poll every (minutes): [15]

       Add another? (y/N)
       > N

[3/5]  MCP servers — long-lived servers your agents can query for
       evidence on demand. We'll set up matching servers for the
       sources you just added.

       Configure Gmail MCP for avery@tessera.com? (Y/n) > Y
       Configure Google Calendar MCP? (Y/n) > Y
       Configure notes filesystem MCP for ~/Documents/notes? (Y/n) > Y
       Add another MCP server? (y/N) > N

       Per-agent access (you can edit later):
         mind agent       → all servers
         diary agent      → all servers
         cold-start agent → none

[4/5]  Webhook URL — where the main process will receive push notifications
       from Gmail, Calendar, and other webhook-kind event sources.

       The daemon's HTTP server binds 127.0.0.1:8731 locally. You need
       a public URL that forwards to it. Options:
         (a) ngrok (we'll set it up; recommended)
         (b) I have my own public URL (reverse proxy, Cloudflare
             Tunnel, Tailscale Funnel, VPS, etc.)
         (c) Skip — the main process still works for reminders and
             on-demand `digest_run` invocations; webhook events are
             just unavailable until a URL is configured
       > a

       ngrok setup
       -----------
       Do you have an ngrok account? (Y/n)
       > N

       Open https://dashboard.ngrok.com/signup, create a free account,
       and copy your authtoken from the "Your Authtoken" page. Paste it
       here (it goes into your shell env as NGROK_AUTHTOKEN; we'll add
       the line to your shell rc):
       > 2a8K4...

       Reserve a static domain? On the free tier you get one
       reserved domain like <name>.ngrok-free.app — recommended,
       because without it your public URL changes every restart and
       you have to re-register webhooks each time. Open
       https://dashboard.ngrok.com/cloud-edge/domains and claim
       one. Paste it here (or blank to use a fresh random URL):
       > digest-avery.ngrok-free.app

       Public URL: https://digest-avery.ngrok-free.app/webhook
       Public URL: https://digest.avery.dev/webhook

[5/5]  Diary schedule — when should the digest land?
       Pick one or more times (HH:MM, comma-separated, your timezone).
       Common patterns: once at morning (06:00), thrice (06:00, 12:30, 21:00).
       > 06:00, 12:30, 21:00

       Profile.md — your voice, who matters to you, what to suppress.
       Open a starter template now? (Y/n)
       > Y
       [opens ~/digest/profile.md in $EDITOR with a template]

       Running cold-start agent...
       ✓ Seeded _principal.json from profile.md

Setup complete. Next steps:
  - The Electron app installs its own launch entry on first run (launchd
    on macOS, autostart on Windows/Linux). No manual unit install needed.
  - Once the app is running, events arrive through normal flow.
  - Your first diary will compose at the next scheduled time, or run
    `digest run` to fire one now.
  - Install the MCP plugin in Claude Code for the `/digest` slash command.
```

No backfill phase. The cold-start agent seeds the principal-anchor and exits. Day 1 starts with one anchor; entities and additional anchors emerge as events arrive.

### `digest config` — adjust later

Subcommand-based CLI for ongoing changes:

```
$ digest config                # show effective config (yours + defaults)
$ digest config show           # same
$ digest config edit           # open ~/digest/config.jsonc in $EDITOR
$ digest config schedule       # interactive prompt for diary_times
$ digest config event-sources  # interactive prompt for event_sources list
$ digest config mcp-servers    # interactive prompt for mcp_servers list
$ digest config timezone       # interactive prompt for timezone
$ digest config model          # interactive prompt for model selection
$ digest config webhook        # interactive prompt for webhook URL
$ digest config set <path> <value>   # one-shot set
$ digest config unset <path>         # remove override, fall back to default
$ digest config validate             # check paths, timezone, time formats, URL reachable
```

Examples:

```
$ digest config schedule
Current diary times: 06:00, 12:30, 21:00
Enter new times (comma-separated, your timezone), or blank to keep:
> 07:00, 13:00

Updated. Schedule is now: 07:00, 13:00
Next scheduled diary firing: today at 13:00.
```

```
$ digest config set model.diary_agent claude-sonnet-4-6
Updated config.jsonc:
  model.diary_agent: claude-opus-4-7 → claude-sonnet-4-6
```

```
$ digest config webhook test
Webhook URL: https://digest.avery.dev/webhook
Daemon bind: 127.0.0.1:8731
Sending test POST to public URL...
✓ Received locally at /webhook/test in 142ms.
```

The `digest config set` and `digest config unset` commands preserve surrounding comments — the writer is a JSONC-aware editor, not a re-emit.

## Validation

The tool validates `config.jsonc` on every load:

- Comments are stripped, then the structural JSON parse runs.
- Timezone parses as an IANA string.
- Every `event_sources[*]` entry has a non-empty `id` and `kind`; `id` is unique across the list.
- Snapshot-kind event sources have `poll_minutes` between 1 and 1440 (defaults to 15 if omitted).
- Every `mcp_servers[*]` entry has a non-empty `id` and `command`; `id` is unique.
- `agent_mcp_access[<role>]` lists only ids present in `mcp_servers`. Roles must be one of `mind | diary | cold_start`.
- `webhook.public_url` is a valid URL. `digest config validate` additionally checks reachability.
- Diary times are valid `HH:MM` strings.
- Model IDs are non-empty (no whitelist — principals add models as Anthropic releases them).

Validation failures print a clear message and exit non-zero. The tool does not auto-fix.

## Relationship to profile.md

`profile.md` and `config.jsonc` are both read at the appropriate moments:

- Agent prompts (cold-start, mind, diary) load `profile.md` via tool calls. They never see `config.jsonc`.
- The runtime parses `config.jsonc` as code. It never tries to parse `profile.md` for operational settings.

`profile.md` is what the agent should know about the principal. `config.jsonc` is what the runtime needs to operate. Earlier iterations mixed them (cadence in `profile.md`); structured fields belong in the structured file.

## What gets configured when

- **First run only:** initial event sources, initial MCP servers, webhook URL, optional first-run `profile.md` scaffold. The cold-start agent runs once.
- **Anytime:** schedule, timezone, model selection, MCP cache TTL, log directory, webhook URL, event sources (add / remove / reconfigure), MCP servers (add / remove / reconfigure), per-agent MCP access.
- **Profile preferences:** edit `profile.md` directly. The mind agent re-seeds the principal-anchor on mtime change.
