# Runtime

Most of the digest is event-driven. The mind agent has no clock — it fires when an event arrives. Only the diary agent runs on a schedule.

This doc specifies the Electron main process's subsystems, how events flow through them, the always-fresh serialization guarantee, failure recovery, and the installation flow. The full stack and process model (including SQLite schema, event-bus types, and module structure) are in [11-backend-architecture.md](11-backend-architecture.md).

## The substrate at a glance

A single long-running process — the **Electron main process** — owns these subsystems:

1. **HTTP webhook server** — receives push notifications from event sources (persona-emulator for the trial; later Gmail, Calendar, Slack, Linear, etc.).
2. **Tunnel manager** — spawns and supervises an ngrok subprocess that exposes the loopback-bound webhook port publicly. Skipped when `webhook.tunnel.kind` is `"external"`.
3. **Reminder scheduler** — sleep-until-fire timer queue over the `reminders` SQLite table.
4. **Diary scheduler** — wall-clock firing at the times declared in `config.jsonc`'s `schedule.diary_times`.
5. **Profile watcher** — observes `~/digest/profile.md` mtime; emits `profile.changed` on edits.
6. **Mind dispatcher** — durable, serialized bus subscriber; spawns the mind-agent Claude Code subprocess per cognition event.
7. **Diary dispatcher** — bus subscriber; waits for the mind queue to drain, then spawns the diary-agent Claude Code subprocess.
8. **Cold-start dispatcher** — bus subscriber for `profile.changed`; spawns the cold-start Claude Code subprocess.
9. **Execution dispatcher** — bus subscriber for `task.fired`; spawns a Claude Code subprocess in permissionless mode to act against the world.
10. **Substrate MCP servers (×3)** — long-lived subprocesses (mind / diary / cold-start), each registering exactly its role's tool allowlist. Spawned Claude Code subprocesses connect to the role-appropriate substrate MCP via `--mcp-config`.
11. **Surface MCP server** — long-lived subprocess exposing `digest_run`, `digest_get`, `diary_act`, `diary_add_comment`, `diary_add_note` to the principal's Claude Code.
12. **External MCP lifecycle** — starts and supervises persona-emulator-mcp (trial) and later gmail-mcp, gcal-mcp, etc.
13. **IPC bridge** — `contextBridge` + `ipcMain` handlers for renderer windows (diary view, Inspector, Settings).
14. **Event bus** — the in-process pub/sub fabric all subsystems talk through. Audit-logged in the `events` table; durable subscribers track cursors in `event_subscriber_cursors`.

The main process does not poll source providers. It does not watch the filesystem for source data (the profile watcher is the only filesystem observer and it watches a single user-authored file). If a source doesn't push, it's not an event source — it's accessible only as an MCP server the agent queries on demand. Snapshot polling and filesystem watching for sources are aspirational additions for a future expansion, not part of this design.

The main process runs Node.js's event loop; subsystems multiplex on it. The expensive work (mind, diary, cold-start, execution agent runs) happens in Claude Code subprocesses; the main process itself is mostly idle.

See [03-cycle.md](03-cycle.md) for what each agent does when invoked; this doc concerns what triggers them. See [11-backend-architecture.md](11-backend-architecture.md) for the actual TypeScript modules, schema DDL, and event bus types.

## Subsystem 1: webhook server

A Fastify HTTP server bound to `webhook.bind_host:bind_port` (default `127.0.0.1:8731`). Each configured event source registers a route. Common routes:

- `POST /webhook/persona-emulator` — trial source; persona-generator pushes synthetic events.
- `POST /webhook/inbox-gmail` — Gmail push notifications (later).
- `POST /webhook/calendar-google` — Google Calendar push notifications (later).
- `POST /webhook/slack-acme` — Slack Events API (later).

Each endpoint:

1. Validates the source (shared-secret check; provider signature where applicable).
2. Hands the payload to the event-source adapter (see [04-adapters.md](04-adapters.md)).
3. The adapter normalizes the payload — stable source ID, identity-handle hints, structured fields.
4. The webhook server emits `webhook.<source-kind>` on the bus.
5. The endpoint returns 200 with no body.

Webhooks deliver pushes, not full state. The adapter (or the spawned mind agent) fetches details the push doesn't carry via the corresponding MCP server. Credentials for those fetches are configured per source in `config.jsonc` (see [10-config.md](10-config.md)).

## Subsystem 2: tunnel manager

The webhook server binds to loopback — it does not face the public internet directly. Providers need a public HTTPS URL to POST to. The tunnel manager bridges the gap.

When `webhook.tunnel.kind` is `"ngrok"` (the default for new installs), the main process spawns and supervises an ngrok subprocess that establishes an outbound persistent connection to ngrok's edge. Public traffic to `webhook.public_url` lands on ngrok's edge and is forwarded down the outbound connection to the loopback port.

Why ngrok and not binding `0.0.0.0`:

- No public IP needed. No router port-forwarding. No firewall reconfiguration.
- ngrok's edge terminates TLS; the main process never sees a public socket.
- One-line config: `webhook.tunnel.kind: "ngrok"` plus an authtoken in env.

The tunnel manager:

1. Reads `webhook.tunnel.authtoken_env` (default `NGROK_AUTHTOKEN`) and exports it to the ngrok subprocess.
2. Spawns `ngrok http <bind_port>` — with `--domain=<webhook.tunnel.domain>` if a reserved domain is configured (free tier allows one).
3. Tails the ngrok subprocess's log and parses the actual public URL it brings up; cross-checks against `webhook.public_url` and warns on mismatch.
4. Restarts the subprocess with exponential backoff if it exits.
5. Emits `tunnel.up` / `tunnel.down` events on the bus for renderer status indicators.

When `webhook.tunnel.kind` is `"external"`, the manager is inactive. The user runs their own tunnel (Cloudflare Tunnel, Tailscale Funnel, reverse proxy, etc.) pointed at `bind_host:bind_port`; the main process just binds locally and trusts that something upstream is delivering inbound traffic.

The tunnel manager does **not** authenticate or rate-limit. Provider-specific signature checks happen on each route in subsystem 1.

## Subsystem 3: reminder scheduler

The mind agent can set reminders via the `set_reminder` MCP tool (see [03a-agent-shape.md](03a-agent-shape.md)). A reminder is "wake me at time T with context C related to anchors A." It serves the agent the way a human's "follow up Tuesday" sticky note does.

Reminders live in the `reminders` table (with related anchors in `reminder_anchor_refs`). The scheduler:

1. At boot, `SELECT * FROM reminders WHERE fired_at IS NULL ORDER BY fires_at` — loads pending reminders.
2. Maintains an in-memory priority queue sorted by `fires_at`.
3. Subscribes to `mind.invocation.done` on the bus and re-reads the table after each mind tick (so newly-set or cancelled reminders are picked up).
4. Sleeps until the next `fires_at`. When it fires:
   - Sets `fired_at` on the row.
   - Emits `reminder.fired` on the bus with the reminder's `context` and `related_anchors`.
5. The mind dispatcher (subsystem 6) picks the event up and spawns a mind-agent subprocess with the reminder as the event payload.

Reminders are agent-scheduled internal events. They flow through the bus like any external observation, so the mind agent reasons over them through the same MCP tools.

## Subsystem 4: diary scheduler

`config.jsonc` declares `schedule.diary_times` — wall-clock times in the principal's timezone — and the diary scheduler emits `schedule.diary_tick` at each.

For Avery's config (`["06:00", "12:30", "21:00"]` Pacific), the scheduler computes each time's next instant in the principal's tz at boot and re-computes after each firing. DST shifts, laptop sleep, and clock skew are handled by recomputing against `now()` in the principal's tz rather than relying on monotonic timers.

The scheduler is naive — it doesn't gate the diary tick on the mind queue. That gating is the diary dispatcher's job (subsystem 7); the scheduler just emits the event on time.

## Subsystem 5: profile watcher

A small `fs.watch`/`chokidar` observer on `~/digest/profile.md`. When the file's mtime changes (the principal saved an edit), the watcher emits `profile.changed` on the bus. The cold-start dispatcher (subsystem 8) consumes the event and spawns a cold-start subprocess to re-seed the principal-anchor.

This is the only filesystem watcher in the design. Profile is the one user-authored file the system reacts to live; everything else is row-based in SQLite.

## Subsystem 6: mind dispatcher

The mind dispatcher is the heart of the always-fresh guarantee. Every cognition-triggering event — webhook of any kind, `reminder.fired`, `diary.comment.added`, `diary.note.added`, `task.completed`, `task.failed` — fans into it.

It is a **durable, serialized bus subscriber** (`bus.on('webhook.*', handler, { durable: true, name: 'mind-dispatcher' })` and so on). The bus's machinery ensures:

- The dispatcher's handler is called once per event, in order.
- The handler's await blocks the next event in the queue from being delivered.
- On crash + restart, unprocessed events are replayed from the dispatcher's cursor in `event_subscriber_cursors`.

Per event, the handler:

1. Assembles the mind-agent system prompt (`disposition.md` + `mind-agent.md` from `~/digest/` or bundled defaults).
2. Builds the MCP config: `digest-substrate-mcp[mind]` + the role's external MCP servers from `agent_mcp_access.mind`.
3. Calls `invokeClaudeCode(...)` with the event payload as user prompt.
4. Awaits subprocess exit (timeout configurable, default 5 min).
5. Emits `mind.invocation.done` with the outcome (exit code, summary).
6. Cursor advances.

The mind dispatcher does not coalesce events — one event, one subprocess. A burst of five Gmail webhooks within seconds produces five sequential mind invocations. Each is a clean per-event reasoning trace.

## Subsystem 7: diary dispatcher

Subscribes to `schedule.diary_tick` (from subsystem 4) and `mind.invocation.done` (from subsystem 6). Durable.

When a `schedule.diary_tick` arrives (or a `digest_run` from the surface MCP), the diary dispatcher:

1. Checks the mind dispatcher's queue state.
2. If empty and no mind invocation is in flight → proceed.
3. If not → wait. The dispatcher uses `mind.invocation.done` as the signal to re-check.
4. Once clear, assembles the diary-agent system prompt + MCP config (`digest-substrate-mcp[diary]` + diary's external MCP servers).
5. Calls `invokeClaudeCode(...)`. Awaits exit (default 15 min timeout).
6. Emits `diary.invocation.done`.

Only one diary invocation runs at a time. An on-demand `digest_run` arriving while a diary is composing blocks with a short bounded wait, then errors if still occupied.

## Subsystem 8: cold-start dispatcher

Subscribes to `profile.changed`. When fired, builds the cold-start system prompt, points its MCP config at `digest-substrate-mcp[cold-start]` (no external MCPs), and spawns the cold-start Claude Code subprocess. On exit, emits `coldstart.invocation.done`.

Also handles the very first cold-start at `digest init` — same code path, manually triggered.

## Subsystem 9: execution dispatcher

Subscribes to `task.fired` (emitted by the renderer's diary view via IPC, or by the surface MCP's `diary_act`). For each task:

1. Builds an execution-agent system prompt parameterized by the task payload.
2. MCP config: the external MCPs needed for the action's `kind` (gmail-mcp for `send_email`, gcal-mcp for `accept_event`/`decline_event`, …). **No substrate MCP** — execution agents cannot touch the cognitive layer.
3. Spawns a Claude Code subprocess in permissionless mode.
4. On exit:
   - Success → emits `task.completed`; sets the originating `diary_components.status` to `acted`.
   - Failure → emits `task.failed`; status stays `open`.

Execution invocations are **not serialized** — multiple concurrent `task.fired` events spawn concurrent Claude Code subprocesses (different recipients, independent actions). The mind dispatcher's serialized queue handles the outcomes downstream.

See [03-cycle.md](03-cycle.md#the-execution-lane-task-events--claude-code-execution--outcome-events) for the full execution lane.

## Subsystem 10: substrate MCP servers

Three long-lived subprocesses, one per agent role. Each is a Node.js process running an MCP server (`@modelcontextprotocol/sdk`) that:

- Registers exactly its role's allowlist (see [03a-agent-shape.md](03a-agent-shape.md)).
- Opens its own `better-sqlite3` connection to `~/digest/digest.db` (WAL mode keeps cross-process coherent).
- Communicates over stdio with the Claude Code subprocess that spawns to use it.

At boot, the main process spawns all three. The dispatchers' `invokeClaudeCode` calls pass a `--mcp-config` pointing at the role-appropriate substrate MCP's stdio socket.

If a substrate MCP server crashes, the main process restarts it. Any in-flight Claude Code subprocess that lost its MCP connection will error and exit; the dispatcher emits a failed outcome.

## Subsystem 11: surface MCP server

A separate long-lived MCP server subprocess, exposed to the principal's Claude Code installation via the standard MCP plugin pattern. Tools: `digest_run`, `digest_get`, `diary_act`, `diary_add_comment`, `diary_add_note`.

It also opens a `better-sqlite3` connection and emits bus events when its mutating tools (`diary_act`, `diary_add_comment`, `diary_add_note`) are called. To emit to the in-process bus from a separate subprocess, the surface MCP and main process share a tiny stdio control channel for event publishing (one line per emit; protocol detailed in [11-backend-architecture.md](11-backend-architecture.md)).

## Subsystem 12: external MCP lifecycle

The main process spawns and supervises the external MCP servers configured under `mcp_servers` in `config.jsonc` (persona-emulator-mcp for the trial; later gmail-mcp, gcal-mcp, …). It restarts them on crash with exponential backoff.

At dispatcher spawn time, the relevant subset (per `agent_mcp_access[<role>]`) is referenced in the Claude Code subprocess's MCP config. Each agent invocation reuses the same long-lived external MCP server instance.

## Subsystem 13: IPC bridge

Connects the renderer windows (diary view, Inspector, Settings) to the main process. Provides a typed `window.digest` API via `contextBridge`. Renderer-side calls (`fireTask`, `addComment`, `addNote`, `getDiary`, `readConfig`, `writeConfig`) IPC to main; main forwards renderer-visible events (`mind.invocation.done`, `diary.invocation.done`, `task.*`, `tunnel.*`) back to active renderer windows via `webContents.send`.

## Subsystem 14: event bus

The bus is in-process pub/sub (see [11-backend-architecture.md](11-backend-architecture.md#event-bus) for the full API). Every emit writes an `events` row before delivery. Durable subscribers (mind dispatcher, diary dispatcher, execution dispatcher) advance cursors in `event_subscriber_cursors`. On main-process restart, the bus replays unprocessed `events` rows from each durable subscriber's cursor.

This is what makes the system crash-safe: even if the main process dies mid-event, the event lives in the audit table and gets re-delivered on the next boot.

## Always-fresh serialization

The diary agent never composes over stale cognitive state.

**Guarantee:** at the moment a diary-agent subprocess spawns, every event the main process has emitted before that moment has been processed by a mind-agent subprocess.

**Mechanism:** the mind dispatcher's durable serialized subscription drains events one at a time. The diary dispatcher subscribes to `mind.invocation.done` and tracks the mind queue's depth. On a `schedule.diary_tick`, the diary dispatcher waits until queue depth is zero, then spawns.

New events arriving during diary composition queue normally on the bus; the mind dispatcher processes them after the diary agent exits.

Principal-authored comments and notes (`diary.comment.added`, `diary.note.added`) enter the same flow: a comment submitted at 11:59am Pacific is processed by the mind dispatcher before the 12:30pm scheduled diary fires.

## Main-process boot sequence

```ts
// src/main/boot.ts (sketch)

async function boot() {
  const config = loadConfig();
  const db     = openDatabase(config);
  await migrate(db);

  const bus = new Bus(db);
  await bus.replayDurableSubscribers();

  // Start subprocesses
  const tunnel       = await startTunnelManager(config, bus);
  const substrateMind  = await startSubstrateMcp('mind', db);
  const substrateDiary = await startSubstrateMcp('diary', db);
  const substrateCold  = await startSubstrateMcp('coldStart', db);
  const surfaceMcp     = await startSurfaceMcp(db, bus);
  const externalMcps   = await startExternalMcps(config);

  // Start subsystems
  const webhook  = await startWebhookServer(config, bus);
  const reminder = startReminderScheduler(db, bus);
  const diarySch = startDiaryScheduler(config, bus);
  const profile  = startProfileWatcher(bus);

  startMindDispatcher(bus, db, substrateMind, externalMcps);
  startDiaryDispatcher(bus, db, substrateDiary, externalMcps);
  startColdStartDispatcher(bus, db, substrateCold);
  startExecutionDispatcher(bus, db, externalMcps);

  setupIpcBridge(bus);
  setupTray();
}
```

The Electron app calls `boot()` at `app.whenReady()`. Crash recovery is just `boot()` running again on the next launch — durable subscribers replay; substrate MCP servers re-spawn; ngrok reconnects.

The app launches via:

- **launchd** on macOS — `~/Library/LaunchAgents/digest.plist` installed by the Electron packager with `KeepAlive` and `RunAtLoad`.
- **systemd** on Linux — equivalent unit with `Restart=always`.
- **autostart** on Windows — registry entry.

For laptop installs, the daemon starts at login and sleeps when the laptop sleeps; on wake, webhook providers retry their queued pushes, durable subscribers continue from their cursors.

## Cold-start (first run and beyond)

`digest init` is one-shot, not part of the boot loop. It writes a minimal `config.jsonc`, opens an empty `digest.db`, runs migrations, then fires the cold-start agent, which seeds the principal-anchor row from `profile.md`. Nothing else is pre-created. No historical events are loaded.

After cold-start exits, `boot()` runs the rest of the subsystems. The first inbound webhook fires a mind-agent subprocess; the first scheduled diary time fires a diary-agent subprocess. Entities and anchors emerge organically through mind-agent action — entities for the common provisional case, direct anchors for high-conviction first sights, and promotions when accumulated evidence justifies (see [01a-entity-model.md](01a-entity-model.md)).

After install, **re-running cold-start happens automatically** whenever `profile.md`'s mtime changes — the profile watcher emits `profile.changed`; the cold-start dispatcher fires.

## Failure recovery

State is in SQLite; everything is recoverable.

- **Webhook missed during downtime.** Webhook providers retry per their policy. On main-process restart, the next webhook arrivals fill the gap. For sources that don't retry far back, the agent can query the corresponding MCP server on demand to backfill context — but the main process doesn't automatically replay history.
- **Reminder fired during downtime.** Reminders persist in `reminders`. At boot, the scheduler `SELECT`s pending reminders; any with `fires_at < now` and `fired_at IS NULL` fire immediately via the bus.
- **Mind / diary / cold-start / execution Claude Code subprocess crashed.** Partial SQLite writes are guarded by per-tool-call transactions inside the substrate MCP server. The dispatcher detects exit code != 0, emits a failed outcome event, and the durable subscriber cursor doesn't advance — so on the next attempt the same event is replayed (or, depending on policy, marked-and-skipped after N retries).
- **Main process crashed entirely.** launchd / systemd restart it. On boot, durable subscribers replay from their cursors; substrate MCP servers re-spawn; ngrok reconnects.
- **Substrate / surface / external MCP server crashed.** The lifecycle manager restarts it. Any in-flight Claude Code subprocess that lost its MCP connection sees a tool error; the dispatcher detects exit and emits a failed outcome.
- **ngrok disconnect.** The tunnel manager reconnects with exponential backoff. Webhook events buffered upstream by the provider (Gmail Pub/Sub retries, Google Calendar retries) are re-delivered on reconnect.
- **LLM API unreachable.** The Claude Code subprocess exits with an error code. Dispatcher emits a failed outcome; cursor doesn't advance; the next opportunity retries. Webhook receipt continues — observation continues even when reasoning is offline.

## Time zones

All scheduling interprets in the principal's declared timezone from `config.jsonc`. The diary scheduler compares against `now()` in the principal's tz at each tick. Wall-clock times (`schedule.diary_times`) are resolved in the principal's tz; DST shifts are handled by recomputing next-fire time after each firing rather than caching offsets.

"Avery's day starts at 6am Pacific" stays true even on a Tokyo network, even when the system clock has drifted, even across DST shifts.

## Installation flow

Reference sequence:

1. **Install the app.** Download the packaged Electron app (DMG / .app / .exe / .AppImage). Or for dev: `npm install && npm run dev`.

2. **First launch.** The app boots; sees no `~/digest/` directory; opens an onboarding window. The onboarding window walks through the `digest init` flow interactively (timezone, event sources, MCP servers, diary schedule, webhook URL via ngrok tunnel, optional `profile.md` scaffold). On completion, writes `~/digest/config.jsonc`, creates `digest.db`, fires the cold-start agent. See [10-config.md](10-config.md) for the interactive flow.

3. **Daily use.** The tray icon stays in the menu bar. Webhook events arrive through the tunnel; reminders fire; scheduled diary ticks compose the day's diary. The principal opens the diary window from the tray when they want to engage.

4. **(Optional) Install the MCP plugin in Claude Code.** Standard plugin install path. Once installed, `/digest` is available in any Claude Code conversation, and the surface MCP tools become available to it.

5. **(Anytime) Adjust via the Settings window** (or the legacy `digest config` CLI). Subcommands cover schedule, event sources, MCP servers, timezone, model selection, webhook URL. See [10-config.md](10-config.md).

After step 2, the app runs continuously. The webhook server accepts pushes; the mind dispatcher fires on each event; the diary dispatcher fires at scheduled times. Step 4 adds the agent-integration surface; step 5 is for when life changes.
