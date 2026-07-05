#!/usr/bin/env -S uv run python
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Build person_generator_langgraph.excalidraw — a dedicated graph-topology
view of the Person Generator pipeline as a LangGraph StateGraph.

Shows: every stage as a LangGraph node, sequential edges, parallel branches
after Stage 7, subgraphs for Stage 7 cascade and Stage 9 fan-out, conditional
retry edges (dashed), and the PipelineState schema as a right-side panel.
"""
from __future__ import annotations
import json
from pathlib import Path

OUT = Path("/Users/mufaddal/Projects/myrico/person_generator_langgraph.excalidraw")

# Color palette (matches main architecture diagram)
PURPLE_FILL = "#ddd6fe"
PURPLE_STROKE = "#6d28d9"
PURPLE_TEXT = "#4c1d95"
GREEN_FILL = "#a7f3d0"
GREEN_STROKE = "#047857"
GREEN_TEXT = "#064e3b"
ORANGE_FILL = "#fed7aa"
ORANGE_STROKE = "#c2410c"
ORANGE_TEXT = "#7c2d12"
YELLOW_FILL = "#fef3c7"
YELLOW_STROKE = "#b45309"
YELLOW_TEXT = "#78350f"
BLUE_FILL = "#dbeafe"
BLUE_STROKE = "#1e3a5f"
BLUE_TEXT = "#1e40af"
GRAY_DIM = "#64748b"
TITLE_BLUE = "#1e40af"

elements = []
seed_counter = [100000]


def next_seed():
    seed_counter[0] += 1
    return seed_counter[0]


def text(x, y, w, h, content, size=14, color="#1e40af", align="left", valign="top", weight="normal"):
    elements.append({
        "type": "text",
        "id": f"text_{next_seed()}",
        "x": x, "y": y, "width": w, "height": h,
        "text": content, "originalText": content,
        "fontSize": size, "fontFamily": 3,
        "textAlign": align, "verticalAlign": valign,
        "strokeColor": color, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
        "roughness": 0, "opacity": 100, "angle": 0,
        "seed": next_seed(), "version": 1, "versionNonce": next_seed(),
        "isDeleted": False, "groupIds": [], "boundElements": None,
        "link": None, "locked": False, "containerId": None, "lineHeight": 1.3,
    })


def box(x, y, w, h, text_content, fill, stroke, text_color, fontsize=13, stroke_width=2, stroke_style="solid"):
    box_id = f"box_{next_seed()}"
    text_id = f"box_text_{next_seed()}"
    elements.append({
        "type": "rectangle",
        "id": box_id,
        "x": x, "y": y, "width": w, "height": h,
        "strokeColor": stroke, "backgroundColor": fill,
        "fillStyle": "solid", "strokeWidth": stroke_width, "strokeStyle": stroke_style,
        "roughness": 0, "opacity": 100, "angle": 0,
        "seed": next_seed(), "version": 1, "versionNonce": next_seed(),
        "isDeleted": False, "groupIds": [],
        "boundElements": [{"id": text_id, "type": "text"}],
        "link": None, "locked": False, "roundness": {"type": 3},
    })
    elements.append({
        "type": "text",
        "id": text_id,
        "x": x + 10, "y": y + 8, "width": w - 20, "height": h - 16,
        "text": text_content, "originalText": text_content,
        "fontSize": fontsize, "fontFamily": 3,
        "textAlign": "center", "verticalAlign": "middle",
        "strokeColor": text_color, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
        "roughness": 0, "opacity": 100, "angle": 0,
        "seed": next_seed(), "version": 1, "versionNonce": next_seed(),
        "isDeleted": False, "groupIds": [], "boundElements": None,
        "link": None, "locked": False, "containerId": box_id, "lineHeight": 1.3,
    })
    return box_id


def arrow(x1, y1, x2, y2, color="#6d28d9", width=2, style="solid", start_id=None, end_id=None):
    dx = x2 - x1
    dy = y2 - y1
    elements.append({
        "type": "arrow",
        "id": f"arrow_{next_seed()}",
        "x": x1, "y": y1, "width": abs(dx), "height": abs(dy),
        "strokeColor": color, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": width, "strokeStyle": style,
        "roughness": 0, "opacity": 100, "angle": 0,
        "seed": next_seed(), "version": 1, "versionNonce": next_seed(),
        "isDeleted": False, "groupIds": [], "boundElements": None,
        "link": None, "locked": False,
        "points": [[0, 0], [dx, dy]],
        "startBinding": {"elementId": start_id, "focus": 0, "gap": 2} if start_id else None,
        "endBinding": {"elementId": end_id, "focus": 0, "gap": 2} if end_id else None,
        "startArrowhead": None, "endArrowhead": "arrow",
    })


# =============================================================================
# Layout
# =============================================================================

CANVAS_W = 2400

# Title
text(600, 30, 1200, 50,
     "Person Generator — LangGraph Topology",
     size=32, color=TITLE_BLUE, align="center")
text(600, 88, 1200, 25,
     "State + graph orchestration across stages · 13 nodes (12 LLM + 1 deterministic) · 2 subgraphs · checkpointed for resumability",
     size=14, color=GRAY_DIM, align="center")

# Legend
box(100, 150, 1100, 95,
    "LEGEND\n"
    "─────────────────────────────────────────────────────────────────────\n"
    "[purple solid]  agent node — invokes claude-agent-sdk with file + structured tools\n"
    "[green solid]   deterministic node — pure Python, no LLM (only Stage 8B)\n"
    "[purple dashed] subgraph node — contains its own LangGraph (Stage 7 cascade, Stage 9 fan-out)\n"
    "[orange]        START / END markers\n"
    "[red dashed]    conditional edge (retry on missing outputs, skip-if-complete)",
    BLUE_FILL, BLUE_STROKE, BLUE_TEXT, fontsize=11, stroke_width=1, stroke_style="dashed")

# Right-side state schema panel
state_x = 1280
state_y = 150
state_w = 1100
state_h = 1900
box(state_x, state_y, state_w, state_h,
    "PipelineState  (TypedDict, flows through every node)\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "\n"
    "  # ── Identity (set by Stage 0) ──\n"
    "  persona_slug:           str            # e.g. 'avery_chen'\n"
    "  persona_name:           str            # e.g. 'Avery Chen'\n"
    "  prompt_text:            str            # verbatim user prompt\n"
    "  working_dir:            Path           # data/<slug>/\n"
    "\n"
    "  # ── Window (set by Stage 0 from config) ──\n"
    "  window_start_date:      str            # ISO date — Day 1   (e.g. '2026-04-19')\n"
    "  window_end_date:        str            # ISO date — Day 35  (e.g. '2026-05-23')\n"
    "\n"
    "  # ── Stage tracking (updated by every node) ──\n"
    "  completed_stages:       list[str]      # ['stage_00_spec', 'stage_01a_life_context', ...]\n"
    "  stage_outputs:          dict[str, list[str]]\n"
    "                                         # stage_id → list of file paths the agent wrote\n"
    "\n"
    "  # ── Stage 7 cascade-specific ──\n"
    "  current_day:            int            # 1..35\n"
    "  last_completed_day:     int            # for mid-cascade resume\n"
    "\n"
    "  # ── Stage 9 fan-out specific ──\n"
    "  completed_mornings:     list[int]      # [6, 7, 8, ...] subset of 6..35\n"
    "\n"
    "  # ── Error handling ──\n"
    "  errors:                 list[dict]     # [{stage, message, retry_count}, ...]\n"
    "\n"
    "  # ── Logging ──\n"
    "  llm_call_log_path:      Path           # graph/logs/llm_calls.jsonl\n"
    "  agent_turn_logs:        dict[str, Path]\n"
    "                                         # stage_id → per-stage turn log\n"
    "\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "\n"
    "Persistence:  LangGraph SQLite checkpointer writes after every node\n"
    "Location:     data/<slug>/.langgraph_checkpoint.db\n"
    "\n"
    "Effects:\n"
    "  • `--from-stage N`        skips to stage N\n"
    "  • `--resume`              picks up from last completed node\n"
    "  • mid-cascade death       Stage 7 re-enters at last_completed_day + 1\n"
    "  • re-run completed slug   no-op (every node sees its stage already complete)\n"
    "\n"
    "Conditional routing notes:\n"
    "  • Every stage node has a 'retry' conditional out-edge. If `agent_runtime`\n"
    "    verification (after the agent terminates) finds expected output files\n"
    "    missing, retry once. Second failure appends to state.errors and either\n"
    "    skips downstream (non-blocking) or terminates the pipeline.\n"
    "  • Stage 0 is idempotent: if personas/<slug>.yaml already exists, the\n"
    "    node returns immediately marking the stage complete.\n"
    "  • Stages 8A, 8B, 9 are parallel-eligible — LangGraph fans them out\n"
    "    after Stage 7 completes; their results merge before END.",
    BLUE_FILL, BLUE_STROKE, BLUE_TEXT, fontsize=10, stroke_width=1)

# =============================================================================
# Graph nodes — sequential column down the left
# =============================================================================

CENTER_X = 600   # center of node column
NODE_W = 380
NODE_X = CENTER_X - NODE_W // 2
NODE_H = 60

# Sequential layout starting at y=280
y_cursor = 280
GAP = 30

# START marker
start_id = box(NODE_X + 80, y_cursor, NODE_W - 160, 45,
               "[ START ]",
               ORANGE_FILL, ORANGE_STROKE, ORANGE_TEXT, fontsize=14, stroke_width=2)
y_cursor += 45 + GAP

# Sequential agent nodes
sequential_stages = [
    ("stage_00_spec",            "Stage 0  ·  Spec Seed", "Tools: Write · write_persona_spec"),
    ("stage_01a_life_context",   "Stage 1a  ·  Life Context", "Tools: Read, Write, Edit"),
    ("stage_01b_character_sketch", "Stage 1b  ·  Character Sketch", "Tools: Read, Write, Edit"),
    ("stage_01c_judgment",       "Stage 1c  ·  Judgment Reasoning", "Tools: Read, Write, Edit"),
    ("stage_01d_profile",        "Stage 1d  ·  Profile.md (derived)", "Tools: Read, Write"),
    ("stage_02_cast",            "Stage 2  ·  Cast", "Tools: Read, Write, Edit · add_cast_member"),
    ("stage_03_archetypes",      "Stage 3  ·  Day Archetypes", "Tools: Read, Write"),
    ("stage_04_channels",        "Stage 4  ·  Channels", "Tools: Read, Write"),
    ("stage_05_storylines",      "Stage 5  ·  Storylines", "Tools: Read, Write, Edit · add_storyline"),
    ("stage_06_window_plan",     "Stage 6  ·  Window Plan", "Tools: Read, Write · add_initial_calendar_event"),
]

node_ids = {}
prev_id = start_id
prev_y = 280 + 45  # bottom of start
for stage_id, title, tools in sequential_stages:
    node_text = f"{title}\n{tools}"
    bid = box(NODE_X, y_cursor, NODE_W, NODE_H, node_text,
              PURPLE_FILL, PURPLE_STROKE, PURPLE_TEXT, fontsize=11)
    node_ids[stage_id] = bid
    # arrow from prev to this
    arrow(CENTER_X, prev_y, CENTER_X, y_cursor, color=PURPLE_STROKE,
          start_id=prev_id, end_id=bid)
    prev_id = bid
    prev_y = y_cursor + NODE_H
    y_cursor += NODE_H + GAP

# Stage 7 subgraph (taller, shows internal cascade)
SG7_H = 140
SG7_TEXT = (
    "Stage 7 SUBGRAPH  ·  Living the Day  (× 35 sequential day nodes)\n"
    "──────────────────────────────────────────────────────────────────\n"
    "  day_01 → day_02 → day_03 → … → day_35\n"
    "  (each node reads prior daily_state, runs agent, updates state)\n"
    "Per-node tools: Read, Write, Edit, Glob · add_calendar_op"
)
sg7_id = box(NODE_X - 80, y_cursor, NODE_W + 160, SG7_H, SG7_TEXT,
             PURPLE_FILL, PURPLE_STROKE, PURPLE_TEXT, fontsize=11,
             stroke_width=2, stroke_style="dashed")
node_ids["stage_07_subgraph"] = sg7_id
arrow(CENTER_X, prev_y, CENTER_X, y_cursor, color=PURPLE_STROKE,
      start_id=prev_id, end_id=sg7_id)
prev_y = y_cursor + SG7_H
y_cursor += SG7_H + 60  # extra gap before fan-out

# =============================================================================
# Parallel fan-out: Stage 8A, Stage 8B, Stage 9 subgraph
# =============================================================================

# Three columns
COL_8A_X = 130
COL_8B_X = 530
COL_9_X = 930
PARALLEL_NODE_W = 350
PARALLEL_NODE_H = 100

s8a_id = box(COL_8A_X, y_cursor, PARALLEL_NODE_W, PARALLEL_NODE_H,
             "Stage 8A  ·  Artifact Emission\n"
             "(batched agent per persona)\n"
             "──────────────────────────────\n"
             "Tools: Read, Glob\n"
             "Structured: emit_email, write_note",
             PURPLE_FILL, PURPLE_STROKE, PURPLE_TEXT, fontsize=11)

s8b_id = box(COL_8B_X, y_cursor, PARALLEL_NODE_W, PARALLEL_NODE_H,
             "Stage 8B  ·  Calendar Replay\n"
             "(deterministic, NO LLM)\n"
             "──────────────────────────────\n"
             "Pure Python. Reads:\n"
             "graph/initial_calendar.json +\n"
             "graph/calendar_ops.jsonl",
             GREEN_FILL, GREEN_STROKE, GREEN_TEXT, fontsize=11)

s9_id = box(COL_9_X, y_cursor, PARALLEL_NODE_W, PARALLEL_NODE_H,
            "Stage 9 SUBGRAPH  ·  Ideal Digest\n"
            "(× 30 morning nodes, PARALLEL)\n"
            "──────────────────────────────\n"
            "morning_06 ║ morning_07 ║ …  morning_35\n"
            "Tools: Read, Glob · add_digest_item · add_suppression",
            PURPLE_FILL, PURPLE_STROKE, PURPLE_TEXT, fontsize=11,
            stroke_width=2, stroke_style="dashed")

# Arrows from Stage 7 subgraph (fan-out)
arrow(NODE_X + NODE_W // 2 - 80, prev_y, COL_8A_X + PARALLEL_NODE_W // 2, y_cursor,
      color=PURPLE_STROKE, start_id=sg7_id, end_id=s8a_id)
arrow(CENTER_X, prev_y, COL_8B_X + PARALLEL_NODE_W // 2, y_cursor,
      color=PURPLE_STROKE, start_id=sg7_id, end_id=s8b_id)
arrow(NODE_X + NODE_W // 2 + 80, prev_y, COL_9_X + PARALLEL_NODE_W // 2, y_cursor,
      color=PURPLE_STROKE, start_id=sg7_id, end_id=s9_id)

# Parallel branch annotation
text(100, y_cursor - 35, 1200, 25,
     "↓  parallel fan-out  ↓     (all three start when Stage 7 completes; merge at END)",
     size=13, color="#dc2626", align="center")

y_cursor += PARALLEL_NODE_H + 50

# END marker
end_id = box(NODE_X + 80, y_cursor, NODE_W - 160, 45,
             "[ END ]",
             ORANGE_FILL, ORANGE_STROKE, ORANGE_TEXT, fontsize=14, stroke_width=2)

# Arrows from each parallel branch to END
arrow(COL_8A_X + PARALLEL_NODE_W // 2, y_cursor - 50,
      CENTER_X - 40, y_cursor,
      color=PURPLE_STROKE, start_id=s8a_id, end_id=end_id)
arrow(COL_8B_X + PARALLEL_NODE_W // 2, y_cursor - 50,
      CENTER_X, y_cursor,
      color=PURPLE_STROKE, start_id=s8b_id, end_id=end_id)
arrow(COL_9_X + PARALLEL_NODE_W // 2, y_cursor - 50,
      CENTER_X + 40, y_cursor,
      color=PURPLE_STROKE, start_id=s9_id, end_id=end_id)

y_cursor += 60

# Conditional-edge annotation at the bottom
text(100, y_cursor, 1180, 80,
     "DASHED RED EDGES (not drawn explicitly to avoid clutter, but present at every agent node):\n"
     "Each agent node has a conditional out-edge → 'retry_node' if expected output files are missing on\n"
     "termination, else → next node. On second retry failure: append to state.errors, continue or terminate.\n"
     "Also at entry: --resume / --from-stage routes through a 'load checkpoint' node before the topology proper.",
     size=11, color="#dc2626", align="left")

# Save
data = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://excalidraw.com",
    "elements": elements,
    "appState": {"viewBackgroundColor": "#ffffff", "gridSize": 20},
    "files": {},
}
OUT.write_text(json.dumps(data, indent=2))
print(f"Wrote {OUT} ({len(elements)} elements)")
