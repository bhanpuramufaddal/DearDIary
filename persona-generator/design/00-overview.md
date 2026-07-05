# Persona Generator — Overview

A reasoning-trace-first pipeline that produces lived-in synthetic data for arbitrary knowledge-worker personas. Each persona's output is both the digest agent's *input* and its *eval ground truth*.

## What we're building

The trial asks for a digest tool for one persona (Avery Chen). We're building beyond it: a generator for *any* persona's data, driven from a free-form prompt. The five reference personas we ship with are just the first five rows of a system anyone can extend.

The dataset is the load-bearing piece. It feeds the digest and grades it, so it has to feel lived-in — procedural randomness won't do.

Per-persona output (everything the digest agent and eval need):

- `persona.db` — SQLite file holding the structured spine: emails, calendar ops, declared moments, noise events, validation log, observability. See [10-storage.md](10-storage.md).
- `profile.md` — front-stage prose compression, the only Stage-1 file the digest reads.
- `activity_log.md` — the spine, a journal-style 35-day narrative.
- `internal/` — reasoning-trace prose: life context, character sketch, judgment essay, cast prose, storyline arcs, daily state.
- `ideal_digests/morning_06..35.json` — eval ground truth (30 mornings).

The digest agent never reads `persona.db` directly. It reads `profile.md` plus the mail / calendar / notes **service emulator** which serves DB rows via REST + MCP — so the agent's interface is production-shaped (`gmail.get_message(id)` etc.), not a synthetic file walk.

## Why this shape

The pipeline is generic. One front door (a free-form prompt), one ten-stage flow, the same model end-to-end. Persona-specific content lives in prose, never in per-persona schemas or override tables.

The data window is 35 days, 2026-04-19 → 2026-05-23. Days 1–5 are warm-up: the persona lives them, but the digest agent doesn't run. Days 6–35 are the eval window — 30 mornings where an ideal digest exists and the agent runs once per morning. The brief's sample digest (May 21) lands as Day 33.

The warm-up matters. Day-6's digest faces five days of accumulated carryovers, stalled threads, and calendar churn — what production digests always face. Day 1 by itself would face nothing, and the eval would be trivial.

## Theoretical foundations

The generator stands on a curated set of frameworks, used as **vocabulary the LLM reasons with in prose** — never as schemas to fill.

- **Front-stage / back-stage (Goffman).** The single most load-bearing framing. `character_sketch.md` is back-stage truth. `profile.md` is the front-stage performance. Back-stage exists prior to performance, so generation order respects this: the inversion at Stage 1 writes the sketch first, then *derives* the profile.
- **Stated vs. revealed preferences (Samuelson).** `profile.md` is *stated*; the persona's behavior across artifacts is *revealed*. The `judgment.md` essay is the bridge — the true preference function that `profile.md` approximates lossily.
- **Big Five personality (OCEAN).** Mentioned in prose where load-bearing ("her neuroticism shows up most around runway"). Never as a structured prelude with scores.
- **Behavioral biases (Kahneman-style).** Loss aversion, present bias, sunk cost, status quo, in-group warmth, anchoring — named inside sentences explaining how they're operating right now. Never as bulleted inventories.
- **Cognitive style (System 1 / System 2).** Drives urgency baseline. Surfaces in prose where the persona's decision pattern matters.
- **Social network theory (Granovetter).** Tie strength is explicit (P0–P4) but the substance of relationships is prose. A weak tie can become a strong tie when context shifts (Marcus during a raise).
- **Multiple-role identity.** Each persona occupies multiple identity roles (CEO / parent / partner / ...). Which role is active in context shapes which rules apply.

These frameworks discipline the prose. They never become structured fields the LLM is asked to populate.

## The core principle

Each load-bearing decision is captured as a **reasoning paragraph** — prose that walks through context, considers alternatives, lands on a conclusion. Entities are named in the prose as **subjects of sentences**. Structure is extracted from paragraphs only where code needs it (filenames, op links, eval IDs), and even then it's the thinnest possible sidecar.

Two failure modes the pipeline structurally avoids:

1. **Schema completion** — asking the LLM to fill JSON fields with values (`personality.neuroticism = 0.58`). The output goes shallow.
2. **Entity-list-as-derivation** — narrative that degenerates into bulleted references (`characters: [marcus, ben]`, `biases_invoked: [...]`). Looks like reasoning; isn't.

See [reasoning traces](03-reasoning-traces.md) for the concrete shifts this produces.

## How to read the rest

Each doc takes one piece of the design and specifies it precisely. Read in order on first pass; refer back as needed.

- **[01-design-decisions.md](01-design-decisions.md)** — top-line decisions table; why agent-loop is the default execution mode.
- **[02-orchestration.md](02-orchestration.md)** — LangGraph state machine: topology, subgraphs, conditional edges, checkpointing.
- **[03-reasoning-traces.md](03-reasoning-traces.md)** — the reasoning-traces principle; where structure stays.
- **[04-storyline-authoring.md](04-storyline-authoring.md)** — storyline-first authoring: object hierarchy, lifecycle vocabulary, noise events with temporal effects.
- **[05-personas.md](05-personas.md)** — the five reference personas and what each stress-tests.
- **[06-pipeline.md](06-pipeline.md)** — the ten-stage pipeline at a glance: graph topology and parallel branches.
- **[07-stage-details.md](07-stage-details.md)** — per-stage spec: inputs, outputs, tools, what's distinctive.
- **[08-validation-and-assembly.md](08-validation-and-assembly.md)** — Stage 9 internals: parallel-per-moment validation, deterministic assembly walk.
- **[09-output-formats.md](09-output-formats.md)** — format specs for `.eml`, `.ics`, `.md`, ideal-digest JSON, calendar ops (as served by the service emulator).
- **[10-storage.md](10-storage.md)** — SQLite-backed storage layer: what's in the DB, what stays as files, full schema, ORM choice.

Diagrams live at `diagrams/pipeline-architecture.excalidraw` and `diagrams/langgraph-orchestration.excalidraw`.
