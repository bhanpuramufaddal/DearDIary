#!/usr/bin/env -S uv run python
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Update both architecture and langgraph diagrams to reflect the SQLite-backed
storage layer:

Architecture diagram (pipeline-architecture.excalidraw):
  1. Delete stage_8b_box / stage_8b_txt (Stage 8B is gone — replay is in the
     calendar service emulator)
  2. Re-center stage_8a to span Phase E full width
  3. Update phase_e_label (no more "deterministic op-replay" mention)
  4. Update stage_8a_txt to show outputs go to DB tables
  5. Update digest_reads_txt to reflect service emulator + persona.db
  6. Update internal_scaffolding_txt to reflect new file/DB split

Langgraph diagram (langgraph-orchestration.excalidraw):
  1. Update Stage 8A node text to mention DB INSERTs
"""
from __future__ import annotations
import json
from pathlib import Path

ARCH = Path("/Users/mufaddal/Projects/myrico/persona-generator/design/diagrams/pipeline-architecture.excalidraw")
GRAPH = Path("/Users/mufaddal/Projects/myrico/persona-generator/design/diagrams/langgraph-orchestration.excalidraw")


PHASE_E_NEW = (
    "PHASE E  ·  ARTIFACT EMISSION  "
    "(LLM-driven prose for emails and notes  ·  INSERTs rows into persona.db)"
)

STAGE_8A_NEW = (
    "STAGE 8A  ·  Artifact Emission  (BATCHED AGENT — one agent per persona, not per artifact)\n"
    "Opus 4.7 agent loop  ·  File tools: Read, Glob  ·  Structured tools: emit_email · write_note\n"
    "\n"
    "Agent reads the foundation once (cached), then loops through every artifact pointer for the day,\n"
    "calling the appropriate emission tool for each. Each tool INSERTs a row into persona.db.\n"
    "Voice matched to tonal_zone extracted from the planted_artifact_trace's conclusion\n"
    "(public_front_stage / professional_front_stage / internal_mid_stage / private_back_stage).\n"
    "X-Synth-* extract fields are columns on the row (Storyline, Moment-Id, Tonal-Zone, Decoy, Source-Plan).\n"
    "\n"
    "→  INSERTs into emails table        (one row per rendered email; service emulator renders RFC 822 on demand)\n"
    "→  INSERTs into notes table         (one row per rendered note; service emulator renders markdown on demand)\n"
    "\n"
    "Stage 8B (deterministic calendar replay) is GONE — absorbed into the calendar service emulator,\n"
    "which generates .ics on demand from initial_calendar_events + calendar_ops rows."
)

DIGEST_READS_NEW = (
    "WHAT THE DIGEST AGENT READS  (via the service emulator, NOT directly from disk)\n"
    "\n"
    "The agent talks to three REST/MCP service emulators that serve rows from persona.db:\n"
    "\n"
    "  mail-service       →  emails / email_attachments / email_threads tables\n"
    "                        Renders RFC 822 .eml on demand. Endpoints:\n"
    "                          GET /messages?q=...&after=...    list / search\n"
    "                          GET /messages/{id}                full email by id\n"
    "                          GET /messages/{id}/attachments/{aid}   attachments\n"
    "\n"
    "  calendar-service   →  initial_calendar_events + calendar_ops tables\n"
    "                        Replays ops on demand. Endpoints:\n"
    "                          GET /events?timeMin=...&timeMax=...\n"
    "                          GET /events/{id}\n"
    "                          GET /snapshot?as_of=<iso-ts>      .ics blob @ T\n"
    "\n"
    "  notes-service      →  notes table\n"
    "                        Endpoints:\n"
    "                          GET /notes?q=...&after=...\n"
    "                          GET /notes/{id}\n"
    "\n"
    "Plus one file the agent reads directly from disk:\n"
    "    data/personas/<slug>/profile.md     ← front-stage compression (lossy)\n"
    "\n"
    "The agent's interface is production-shaped (MCP tools + REST), not a file walk.\n"
    "Swap an emulator for the real service and the agent runs unchanged.\n"
    "\n"
    "X-Synth-* metadata exists as columns on the rows but the emulator renders\n"
    "them as hidden headers in .eml / .ics — invisible to the agent, read only\n"
    "by the eval harness."
)

INTERNAL_SCAFFOLDING_NEW = (
    "INTERNAL SCAFFOLDING  (digest agent does NOT see; lives in persona-generator's working dir)\n"
    "\n"
    "  data/personas/<slug>/\n"
    "    persona.db                   ← SQLite, the structured spine\n"
    "      ├ personas, cast\n"
    "      ├ storylines, declared_moments, moment_supporting_artifacts\n"
    "      ├ noise_events, noise_effects, planned_artifacts\n"
    "      ├ emails, email_attachments, email_threads, notes\n"
    "      ├ initial_calendar_events, calendar_ops\n"
    "      ├ validation_log\n"
    "      └ agent_runs, agent_tool_calls, llm_calls  (observability)\n"
    "    activity_log.md              ← 35-day journal (spine, prose)\n"
    "    internal/                    ← prose only\n"
    "      persona_origin.md\n"
    "      life_context.md\n"
    "      character_sketch.md        ← back-stage truth\n"
    "      judgment.md                ← operational essay\n"
    "      cast.md                    ← P0–P1 multi-paragraph profiles\n"
    "      day_archetypes.md\n"
    "      channels.md\n"
    "      window_plan.md\n"
    "      storylines/<id>/arc.md     ← narrative arc per storyline\n"
    "      daily_state/day_NN.md      ← 35 journal entries\n"
    "    ideal_digests/morning_NN.json  ← eval ground truth (30 files; Stage 9b output)\n"
    "    .langgraph_checkpoint.db     ← pipeline orchestration state (separate DB)"
)


GRAPH_STAGE_8A_NEW = (
    "Stage 8A  ·  Artifact Emission\n"
    "(batched agent per persona)\n"
    "──────────────────────────────\n"
    "Tools: Read, Glob\n"
    "Structured: emit_email, write_note\n"
    "  (INSERTs into emails / notes\n"
    "   tables in persona.db)"
)


def patch_excalidraw(path: Path, replacements: dict[str, str], deletions: set[str] = frozenset()) -> tuple[int, int]:
    """Apply text replacements and element deletions. Returns (updated_count, deleted_count)."""
    data = json.loads(path.read_text())
    updated = 0
    if deletions:
        before = len(data["elements"])
        data["elements"] = [e for e in data["elements"] if e.get("id") not in deletions]
        deleted = before - len(data["elements"])
    else:
        deleted = 0
    for e in data["elements"]:
        eid = e.get("id")
        if eid in replacements:
            new = replacements[eid]
            e["text"] = new
            e["originalText"] = new
            updated += 1
    path.write_text(json.dumps(data, indent=2))
    return updated, deleted


def recenter_stage_8a(path: Path):
    """Stage 8A is currently at x=150, w=1100. Stage 8B box was at x=1290, w=1230.
    With 8B gone, re-center 8A across the diagram's wider span (150..2520)."""
    data = json.loads(path.read_text())
    for e in data["elements"]:
        if e.get("id") == "stage_8a_box":
            e["x"] = 150
            e["width"] = 2370       # span across what was 8a+gap+8b
        elif e.get("id") == "stage_8a_txt":
            e["x"] = 170
            e["width"] = 2330
    path.write_text(json.dumps(data, indent=2))


def main():
    # Architecture diagram
    n_arch, d_arch = patch_excalidraw(
        ARCH,
        {
            "phase_e_label": PHASE_E_NEW,
            "stage_8a_txt": STAGE_8A_NEW,
            "digest_reads_txt": DIGEST_READS_NEW,
            "internal_scaffolding_txt": INTERNAL_SCAFFOLDING_NEW,
        },
        deletions={"stage_8b_box", "stage_8b_txt"},
    )
    recenter_stage_8a(ARCH)
    print(f"pipeline-architecture: {n_arch} text updates, {d_arch} deletions, stage_8a re-centered")

    # Langgraph diagram
    n_graph, _ = patch_excalidraw(
        GRAPH,
        {"box_text_100125": GRAPH_STAGE_8A_NEW},
    )
    print(f"langgraph-orchestration: {n_graph} text updates")


if __name__ == "__main__":
    main()
