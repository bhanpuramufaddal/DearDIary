# digest-agent

A daily-digest triage tool driven by three Claude Code agents. Reads the principal's inbox, calendar, and notes; produces an A2UI diary with priority items, missed-thread detection, contradiction flags, and dispatchable components that a calling agent (Claude Code) can act on.

## How it works

Three discrete agent invocations make up the system:

- **Mind agent** — event-driven. Runs whenever new events arrive (webhook from email/calendar, principal MCP comment/note, fired reminder). Receives one event as direct input; creates entities or anchors as warranted; promotes entities once evidence accumulates; updates layers, relationships, and predictions; sets reminders for itself; exits.
- **Diary agent** — scheduled (per `config.jsonc`) or on-demand via the MCP `digest_run` tool. The daemon's serialization guarantees pending mind work is done first. Reads the substrate as-is, composes the diary JSON for today, drafts dispatchable replies (draft + validate two-pass), emits efference predictions on dispatched components, and writes the diary. Does not modify the substrate; observations for the mind agent land in the day's thinking layer.
- **Cold-start agent** — one-shot at `digest init`. Reads `profile.md` and seeds the principal-anchor only. No historical import.

Cognitive substrate lives in files under `~/digest/`: `profile.md` (principal-authored prose), `config.jsonc` (operational settings), `disposition.md` (shared system prompt), `anchors/*.json` (committed cognitive primitives), `entities/*.json` (provisional subjects with edges to anchors), `reminders/*.json` (agent's self-scheduled callbacks), `diary/*.json` (the principal-facing A2UI artifact), `plays/*.md` (cognitive precedent library).

The agents decide. Rules are substrate they read from and write to — not gates.

## Quickstart

The digest agent is an Electron + TypeScript app, not a pip package. It builds with esbuild and spawns Claude Code subprocesses for cognition, so you need Node 20+ and the `claude` CLI on your `PATH`.

```bash
npm install                    # postinstall rebuilds better-sqlite3 for Electron
npm run dev                    # build + launch the Electron app (tray icon appears)
npm test                       # vitest suite (rebuilds better-sqlite3 for node, then back for electron)
npm run typecheck              # tsc over main + renderer
```

For a real end-to-end run against the bundled synthetic persona, use **test mode** — an in-process persona emulator streams the persona's 35 days through the live pipeline against a synthetic clock:

```bash
cp .env.testmode .env.testmode.local   # then edit: set DIGEST_TEST_PERSONA, ANTHROPIC_API_KEY, sandbox dir
npm run start:test                      # scripts/start-test.sh — seeds profile.md, boots in persona test mode
npm run eval                            # grade a composed diary against the persona's ground-truth digests
```

For real-world install (DMG, onboarding, connecting Gmail/Calendar MCPs, the `/digest` Claude Code plugin), see [`INSTALL.md`](INSTALL.md) and [`design/07-execution-surfaces.md`](design/07-execution-surfaces.md).

## Start reading

[`design/00-architecture-overview.md`](design/00-architecture-overview.md) → thesis, the three agents, substrate, runtime.

Deep dives in numbered order:

- `01-anchor-model.md` — committed cognitive primitives
- `01a-entity-model.md` — provisional subjects and the promotion path
- `02-diary-model.md` — A2UI structure, components, comments, notes
- `03-cycle.md` — the three agent invocations
- `03a-agent-shape.md` — Claude Code Agent SDK + tool allowlists
- `04-adapters.md` — webhook + MCP-snapshot adapters
- `05-plays.md` — cognitive precedent library
- `06-profile-schema.md` — user-authored seed
- `07-execution-surfaces.md` — CLI + MCP surfaces
- `08-runtime.md` — event substrate
- `09-eval.md` — golden-fixture rubric
- `10-config.md` — operational settings

The four prompts at `design/prompts/` are the system prompts the agents run under:

- `disposition.md` — shared base for all three agents
- `mind-agent.md` — perception agent
- `diary-agent.md` — deliberation agent
- `cold-start-agent.md` — setup agent

## Status

Implemented and running. The Electron main process wires the full pipeline end-to-end (`src/main/boot.ts`): SQLite substrate + migrations, typed event bus with durable subscribers, webhook server + ngrok tunnel, reminder/diary/profile schedulers, all four dispatchers (mind / diary / cold-start / execution), the role-scoped substrate MCP servers, the per-service persona MCPs (email / calendar / notes), and the renderer windows (diary / inspector / settings / onboarding).

~24k lines of TypeScript under `src/` with ~40 Vitest suites; `npm run typecheck` is clean. Test mode drives the bundled persona through the live agents against a synthetic clock, and `npm run eval` grades the output. Telemetry exports to Langfuse via OpenTelemetry when `LANGFUSE_*` is set.

In flight: a substrate-MCP decomposition (per-domain tool modules under `src/main/mcp/substrate/tools/`) and the **plays** system — a cognitive-precedent library seeded at boot (`src/main/db/seedPlays.ts`, `prompts/seed-plays/`).
