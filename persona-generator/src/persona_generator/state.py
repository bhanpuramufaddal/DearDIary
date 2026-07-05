"""Pipeline-state TypedDict that flows through every LangGraph node."""

from __future__ import annotations

from pathlib import Path
from typing import TypedDict


class PipelineState(TypedDict, total=False):
    # Identity (set by Stage 0)
    persona_slug: str
    persona_name: str
    prompt_text: str
    working_dir: Path

    # Window
    window_start_date: str  # ISO date — Day 1
    window_end_date: str  # ISO date — Day 35

    # Stage tracking
    completed_stages: list[str]
    stage_outputs: dict[str, list[str]]  # stage_id → output paths or row counts

    # Cascade (Stage 7)
    current_day: int
    last_completed_day: int

    # Eval window (Stage 9)
    completed_mornings: list[int]

    # Errors
    errors: list[dict]

    # Logging
    llm_call_log_path: Path
    agent_turn_logs: dict[str, Path]  # stage_id → log path
