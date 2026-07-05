#!/usr/bin/env -S uv run python
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Remove all references to artifacts/tasks.md and the add_task tool from both
excalidraw diagrams. Tasks have been dropped from the design entirely; only
notes remain as the non-email/non-calendar artifact kind.

Edits both Phase E label, Stage 8A box, and the "WHAT THE DIGEST AGENT READS"
panel in pipeline-architecture.excalidraw, plus the Stage 8A box in
langgraph-orchestration.excalidraw.
"""
from __future__ import annotations
import json
from pathlib import Path

ARCH = Path("/Users/mufaddal/Projects/myrico/persona-generator/design/diagrams/pipeline-architecture.excalidraw")
GRAPH = Path("/Users/mufaddal/Projects/myrico/persona-generator/design/diagrams/langgraph-orchestration.excalidraw")


# Pipeline architecture — Phase E label
PHASE_E_OLD = "PHASE E  ·  ARTIFACT EMISSION  (LLM-driven prose for emails/notes/tasks  ·  deterministic op-replay for calendar)"
PHASE_E_NEW = "PHASE E  ·  ARTIFACT EMISSION  (LLM-driven prose for emails and notes  ·  deterministic op-replay for calendar)"

# Pipeline architecture — Stage 8A box
STAGE_8A_NEW = (
    "STAGE 8A  ·  Artifact Emission  (BATCHED AGENT — one agent per persona, not per artifact)\n"
    "Opus 4.7 agent loop  ·  File tools: Read, Glob  ·  Structured tools: emit_email · write_note\n"
    "\n"
    "Agent reads the foundation once (cached), then loops through every artifact pointer in activity_log.md, calling\n"
    "the appropriate emission tool for each. Amortizes foundation-reading across all of the day's artifacts.\n"
    "Voice matched to tonal_zone extracted from the planted_artifact_trace's conclusion\n"
    "(public_front_stage / professional_front_stage / internal_mid_stage / private_back_stage).\n"
    "Emits hidden X-Synth-* extract headers (Storyline, Tonal-Zone, Decoy, Source-Trace) for eval.\n"
    "\n"
    "→  artifacts/inbox/*.eml          (RFC 822 with proper threading)\n"
    "→  artifacts/notes/*.md           (with YAML frontmatter for eval extracts)"
)

# Pipeline architecture — "What the digest agent reads" panel
DIGEST_READS_NEW = (
    "WHAT THE DIGEST AGENT READS\n"
    "\n"
    "  data/<slug>/\n"
    "    profile.md                    ← front-stage compression (lossy)\n"
    "    artifacts/\n"
    "      inbox/*.eml                ← emails (≈300–1500 per persona)\n"
    "      calendar.ics               ← full final iCalendar (SEQUENCE / LAST-MODIFIED)\n"
    "      notes/*.md                 ← persona's notes\n"
    "    graph/\n"
    "      initial_calendar.json      ← seed calendar state at Day 1, 00:00\n"
    "      calendar_ops.jsonl         ← chronological op log (rescheduling churn,\n"
    "                                    decline patterns — real digest signal)\n"
    "      calendar_snapshots/        ← per-day calendar state; for eval at\n"
    "        calendar_day_NN.ics        morning M, agent reads day_(M-1).ics\n"
    "\n"
    "The agent sees the front-stage profile, the lived artifacts, and the\n"
    "calendar state (initial + ops + per-day snapshots). The X-Synth-* extract\n"
    "headers in emails / .ics / frontmatter exist but the agent doesn't parse\n"
    "them — they are invisible at runtime, read only by the eval harness.\n"
    "\n"
    "The digest agent must reconstruct from this lossy view what the Stage-9\n"
    "ideal-digest pipeline saw with full back-stage context. The gap is what\n"
    "eval measures."
)

# Langgraph orchestration — Stage 8A box
GRAPH_STAGE_8A_NEW = (
    "Stage 8A  ·  Artifact Emission\n"
    "(batched agent per persona)\n"
    "──────────────────────────────\n"
    "Tools: Read, Glob\n"
    "Structured: emit_email, write_note"
)


def patch_excalidraw(path: Path, replacements: dict[str, str]) -> int:
    data = json.loads(path.read_text())
    updated = 0
    for e in data["elements"]:
        eid = e.get("id")
        if eid in replacements:
            new = replacements[eid]
            e["text"] = new
            e["originalText"] = new
            updated += 1
    path.write_text(json.dumps(data, indent=2))
    return updated


def main():
    n_arch = patch_excalidraw(
        ARCH,
        {
            "phase_e_label": PHASE_E_NEW,
            "stage_8a_txt": STAGE_8A_NEW,
            "digest_reads_txt": DIGEST_READS_NEW,
        },
    )
    n_graph = patch_excalidraw(GRAPH, {"box_text_100125": GRAPH_STAGE_8A_NEW})
    print(f"pipeline-architecture: {n_arch} elements updated")
    print(f"langgraph-orchestration: {n_graph} elements updated")


if __name__ == "__main__":
    main()
