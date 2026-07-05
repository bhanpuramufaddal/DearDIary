# Myrico

**A synthetic-persona triage eval for daily-digest AI agents.**

Three subprojects in one monorepo. Together they let you (1) generate a lived-in 35-day synthetic life for any knowledge-worker persona, (2) serve it as production-shape REST + webhook + MCP, and (3) grade a digest agent that consumes it.

| Subproject | Status | What it does | Start reading |
|---|---|---|---|
| [`persona-generator/`](persona-generator/) | ✓ Complete · ~78 unit tests | LangGraph + `claude-agent-sdk` pipeline. 14 stages of Opus/Haiku authoring produce 35 days of emails, notes, calendar ops, declared digest moments, lifecycle cascade, and per-morning ground-truth JSON. | [`persona-generator/design/00-overview.md`](persona-generator/design/00-overview.md) |
| [`service-emulator/`](service-emulator/) | ✓ Complete · ~18 unit tests | FastAPI + MCP + webhook over the generator's SQLite DB. Synthetic clock with `as_of` filtering so the digest agent sees only the persona's past. | [`service-emulator/README.md`](service-emulator/README.md) |
| [`digest-agent/`](digest-agent/) | ✓ Implemented · ~24k LOC · ~40 test suites | Electron + TypeScript app. Three-agent system (mind / diary / cold-start) plus an execution agent reads inbox + calendar + notes and produces an A2UI diary with priority items, contradiction flags, and dispatchable replies. Test mode drives the bundled persona through the live pipeline. | [`digest-agent/design/00-architecture-overview.md`](digest-agent/design/00-architecture-overview.md) |

## What you can do right now

This repo ships **`data/personas/avery_chen/`** — a fully generated reference dataset so you don't have to wait three hours for the pipeline to run. Stats:

- **8 storylines** across work + family + decoy noise (`series_a_raise`, `design_partner_renewal`, `soc2_type2_audit`, `case_study_series`, `q2_board_prep`, `wren_school_transition`, `summer_family_logistics`, `background_noise`)
- **90 declared moments** with full lifecycle history (SHIFTED / CANCELED / MODIFIED across noise events)
- **253 emails · 55 notes · 24 calendar ops · 19 initial calendar events**
- **30 `ideal_digests/morning_NN.json`** files — the per-morning eval ground truth
- **Validation breakdown:** 51 pass · 26 correct · 13 fail (under the "should this surface?" validator philosophy)

Boot the emulator over this dataset:

```bash
git clone git@github.com:bhanpuramufaddal/Myrico-digest.git
cd Myrico-digest/service-emulator
uv sync
uv run service-emulator serve avery_chen     # REST on http://127.0.0.1:8000
```

Open `http://127.0.0.1:8000/docs` for the interactive API, or hit:

```bash
curl 'http://127.0.0.1:8000/mail/messages?as_of=2026-05-13&limit=3'
curl 'http://127.0.0.1:8000/calendar/events?as_of=2026-05-15T07:00:00-07:00'
cat data/personas/avery_chen/ideal_digests/morning_33.json | jq .
```

MCP transport for an MCP-capable client:

```bash
uv run service-emulator mcp avery_chen        # stdio MCP
```

Webhook replay (synthetic clock walks the window, posts events to a URL):

```bash
uv run service-emulator replay avery_chen --webhook-url http://localhost:9999 --speedup 3600
```

## Architecture

```
                      Author once                     Read forever
                          ↓                                ↓
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│   persona-generator (Python)    │         │   service-emulator (Python)      │
│   LangGraph · claude-agent-sdk  │         │   FastAPI · MCP · httpx webhooks │
│                                 │         │                                  │
│   14 stages:                    │         │   GET /mail/messages?as_of=…     │
│     Stage 0  — spec seed        │  ────→  │   GET /mail/messages/{id} (.eml) │
│     Stage 1a–d — foundation     │   DB    │   GET /calendar/events?as_of=…   │
│     Stage 2   — cast            │         │   GET /calendar/ics              │
│     Stage 3–4 — archetypes,     │         │   GET /notes/{id} (.md)          │
│                  channels       │         │   GET /mail/threads/{id}         │
│     Stage 5a/b/c — storylines   │         │                                  │
│                    (3-phase)    │         │   MCP tools:                     │
│     Stage 6   — window plan     │         │     mail_search, mail_get,       │
│     Stage 7   — living the day  │         │     mail_thread, calendar_list,  │
│                  × 35 (Haiku)   │         │     calendar_get, notes_search,  │
│     Stage 8   — gap-fill        │         │     notes_get                    │
│     Stage 9a  — validation      │         │                                  │
│     Stage 9b  — assembly        │         │   Webhook publisher:             │
│                                 │         │     replay window @ speedup,     │
│   Output:                       │         │     POST email.delivered /       │
│     data/personas/<slug>/       │         │     note.created / calendar.op   │
│       persona.db                │         │                                  │
│       internal/*.md             │         └──────────────┬───────────────────┘
│       ideal_digests/*.json      │                        │
│       profile.md                │                        │ Per-tick events
│       activity_log.md           │                        │ + on-demand reads
└─────────────────────────────────┘                        ↓
                                              ┌─────────────────────────────┐
                                              │   digest-agent (TypeScript) │
                                              │   3-agent system (planned)  │
                                              │                             │
                                              │     mind  · perception      │
                                              │     diary · deliberation    │
                                              │     cold-start · seeding    │
                                              │                             │
                                              │   Output: A2UI diary JSON   │
                                              │   Graded vs morning_NN.json │
                                              └─────────────────────────────┘
```

## Generating a new persona

The pipeline runs against real Anthropic models — set your key first:

```bash
export ANTHROPIC_API_KEY=sk-...
cd persona-generator
uv sync
uv run persona-gen new "Vikram Mehta is a long/short equity PM at a multi-strat fund in NYC..."
uv run persona-gen generate run vikram_mehta
```

Stages 0–4 take ~30 min total. Stage 5 (the heaviest authoring stage, three Opus phases per storyline) takes ~40–50 min. Stage 7 (35 daily Haiku agents) takes another ~50 min. Stage 9a (~90 parallel validators) ~30 min. Stage 9b is deterministic and runs in seconds. **End-to-end: roughly 2.5–3 hours.** Resumable at every stage via on-disk idempotency.

## Repo layout

```
.
├── README.md                  ← you are here
├── persona-generator/          Python · 14 stages · ~78 unit tests
│   ├── design/                 11 design docs (00-overview → 10-storage)
│   ├── src/persona_generator/
│   │   ├── stages/             stage_00_spec → stage_09b_assembly
│   │   ├── prompts/            committed system + user prompts per stage
│   │   ├── tools/              structured tools (storyline, cast, artifact_emit, validation, …)
│   │   ├── models.py           SQLModel schema for the persona DB
│   │   ├── graph.py            LangGraph pipeline wiring
│   │   ├── pipeline.py         persona-gen CLI entrypoint
│   │   └── artifact_time.py    target_render_iso backfill helper
│   ├── scripts/                meta-prompting harness (generate_stage_prompts.py)
│   └── tests/                  unit + integration
│
├── service-emulator/           Python · FastAPI + MCP + webhook · ~18 unit tests
│   └── src/service_emulator/
│       ├── rest/               app, mail.py, calendar.py, notes.py, webhooks.py
│       ├── mcp/                stdio MCP server
│       ├── rendering/          eml.py (RFC 822), ics.py (iCalendar), notes.py
│       ├── clock.py            synthetic clock + as_of parsing
│       └── cli.py              service-emulator CLI entrypoint
│
├── digest-agent/               TypeScript · Electron · esbuild
│   ├── design/                 12 design docs + diagrams + 5 agent system prompts
│   ├── prompts/                disposition, mind, diary, cold-start, execution + playbook + seed-plays
│   ├── src/                    main / renderer / shared
│   └── scripts/                eval-digest.ts, regen-prompts.ts, diag-substrate-tools.mjs
│
├── data/personas/avery_chen/   ✓ committed reference dataset
│   ├── persona.db              SQLite — storylines, emails, notes, calendar, validation
│   ├── profile.md              digest-facing summary
│   ├── activity_log.md         35-day diary
│   ├── internal/               persona_origin, life_context, character_sketch, judgment,
│   │                           cast, day_archetypes, channels, window_plan,
│   │                           daily_state/day_01.md … day_35.md,
│   │                           storylines/<id>/arc.md
│   └── ideal_digests/          morning_06.json … morning_35.json (30 files)
│
├── personas/                   per-persona YAML seeds (Stage 0 output)
└── trial-brief.pdf             original assignment
```

## Diagrams (executive overview)

Five hand-drawn diagrams under [`diagrams/`](diagrams/) tell the project's story top-down:

1. [Persona generator architecture](diagrams/01-persona-generator-architecture.png) — one paragraph in, 35 days of synthetic life out
2. [Service emulator architecture](diagrams/02-emulator-architecture.png) — clock-dial-as-knob
3. [Digest agent architecture](diagrams/03-digest-agent-architecture.png) — three small agents share one notebook
4. [One email's journey](diagrams/04-digest-agent-email-timeline.png) — Mon 4:47 PM email → Tue 7:30 AM brief
5. [The agent's memory](diagrams/05-digest-agent-memory.png) — anchors, entities, predictions, reminders, plays — and how they move

For a 3-minute presentation: show **#1 → #2 → #5**. For 10 minutes: all five in order. See [`diagrams/README.md`](diagrams/README.md).

## Design docs

**Persona generator** — 11 documents under [`persona-generator/design/`](persona-generator/design/) cover overview, design decisions, orchestration, reasoning traces, storyline authoring, personas catalog, pipeline shape, per-stage spec, validation + assembly, output formats, and storage. Start with [`00-overview.md`](persona-generator/design/00-overview.md).

**Digest agent** — 12 documents under [`digest-agent/design/`](digest-agent/design/) cover the three-agent architecture, anchor + entity model, diary model, cycle, agent shape, adapters, plays, profile schema, execution surfaces, runtime, eval rubric, and config. Start with [`00-architecture-overview.md`](digest-agent/design/00-architecture-overview.md).

**Service emulator** — minimal API contract; see [`service-emulator/README.md`](service-emulator/README.md).

## Status

- **persona-generator** — feature-complete. Avery Chen reference dataset committed. Three more reference personas (`vikram_mehta`, `dana_levin`, `aisha_williams`) planned to stress-test prompt-agnosticism across professions.
- **service-emulator** — feature-complete. REST + MCP + webhook all live. Tested end-to-end against the avery_chen reference dataset.
- **digest-agent** — implemented and running. Full Electron pipeline wired in `src/main/boot.ts` (SQLite substrate, event bus, webhook + tunnel, schedulers, mind/diary/cold-start/execution dispatchers, role-scoped substrate MCP servers, renderer windows). ~24k LOC, ~40 Vitest suites, clean typecheck. Test mode streams the bundled persona through the live agents; `npm run eval` grades the result. Origin spec lives at [`trial-brief.pdf`](trial-brief.pdf). In flight: substrate-MCP tool decomposition + the plays precedent library.

## Requirements

- Python 3.12+ with [uv](https://docs.astral.sh/uv/) for `persona-generator` and `service-emulator`
- Node 20+ with npm for `digest-agent`
- Anthropic API key (only needed for `persona-gen generate`; the emulator + the reference dataset don't require it)

## License

TBD. The original assignment is at [`trial-brief.pdf`](trial-brief.pdf).
# DearDIary
