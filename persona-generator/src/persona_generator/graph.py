"""Top-level LangGraph pipeline.

Phase B: extends Phase A's single-node graph with the four foundation stages.
Order: START → stage_00 → 1a → 1b → 1c → 1d → END.

Each node idempotency-checks: if its outputs are already on disk + in the DB,
it short-circuits without invoking the agent.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from .db import persona_dir
from sqlmodel import Session, select

from .models import Cast
from .db import engine_for
from .stages.stage_00_spec import run_stage_00
from .stages.stage_01a_life_context import run_stage_01a
from .stages.stage_01b_character_sketch import run_stage_01b
from .stages.stage_01c_judgment import run_stage_01c
from .stages.stage_01d_profile import run_stage_01d
from .stages.stage_02_cast import run_stage_02
from .stages.stage_03_archetypes import run_stage_03
from .stages.stage_04_channels import run_stage_04
from .stages.stage_05_storylines import (
    MIN_MOMENTS,
    MIN_STORYLINES,
    run_stage_05,
)
from .stages.stage_06_window_plan import (
    MIN_INITIAL_EVENTS as STAGE_06_MIN_EVENTS,
    run_stage_06,
)
from .stages.stage_07_living_day import run_stage_07
from .stages.stage_08_artifact_emission import run_stage_08
from .stages.stage_09a_validation import run_stage_09a
from .stages.stage_09b_assembly import run_stage_09b
from .models import DeclaredMoment, InitialCalendarEvent, PlannedArtifact, Storyline
from .state import PipelineState


def _is_complete_file(slug: str, relpath: str, min_chars: int) -> bool:
    p = persona_dir(slug) / relpath
    if not p.exists():
        return False
    try:
        return len(p.read_text(encoding="utf-8")) >= min_chars
    except OSError:
        return False


def _node_stage_00(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    return run_stage_00(
        slug=slug,
        prompt_text=state["prompt_text"],
        name_hint=state.get("persona_name"),
    )


def _node_stage_01a(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    if _is_complete_file(slug, "internal/life_context.md", min_chars=8000):
        return {"completed_stages": ["stage_01a_life_context"]}
    return run_stage_01a(slug=slug)


def _node_stage_01b(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    if _is_complete_file(slug, "internal/character_sketch.md", min_chars=8000):
        return {"completed_stages": ["stage_01b_character_sketch"]}
    return run_stage_01b(slug=slug)


def _node_stage_01c(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    if _is_complete_file(slug, "internal/judgment.md", min_chars=7000):
        return {"completed_stages": ["stage_01c_judgment"]}
    return run_stage_01c(slug=slug)


def _node_stage_01d(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    if _is_complete_file(slug, "profile.md", min_chars=2500):
        return {"completed_stages": ["stage_01d_profile"]}
    return run_stage_01d(slug=slug)


def _node_stage_02(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    if _is_complete_file(slug, "internal/cast.md", min_chars=6000):
        with Session(engine_for(slug)) as session:
            rows = session.exec(select(Cast)).all()
        if len(rows) >= 5 and {r.signal_tier for r in rows} & {"p0"} and {r.signal_tier for r in rows} & {"p1"}:
            return {"completed_stages": ["stage_02_cast"]}
    return run_stage_02(slug=slug)


def _node_stage_03(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    if _is_complete_file(slug, "internal/day_archetypes.md", min_chars=5000):
        return {"completed_stages": ["stage_03_archetypes"]}
    return run_stage_03(slug=slug)


def _node_stage_04(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    if _is_complete_file(slug, "internal/channels.md", min_chars=3500):
        return {"completed_stages": ["stage_04_channels"]}
    return run_stage_04(slug=slug)


def _node_stage_05(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    # Delegate to stage_05_is_complete() — checks Phase A + every Phase B + Phase C.
    # Coarse counts (storylines, moments) are insufficient: a kill mid-Phase-B
    # leaves several detail storylines empty and Phase C unauthored, while the
    # counts could still be over the floors. run_stage_05's inner idempotency
    # handles the per-phase resume.
    from .stages.stage_05_storylines import stage_05_is_complete
    if stage_05_is_complete(slug):
        return {"completed_stages": ["stage_05_storylines"]}
    return run_stage_05(slug=slug)


def _node_stage_06(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    if _is_complete_file(slug, "internal/window_plan.md", min_chars=3500):
        with Session(engine_for(slug)) as session:
            n_events = len(session.exec(select(InitialCalendarEvent)).all())
        if n_events >= STAGE_06_MIN_EVENTS:
            return {"completed_stages": ["stage_06_window_plan"]}
    return run_stage_06(slug=slug)


def _node_stage_07(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    return run_stage_07(slug=slug)


def _node_stage_08(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    return run_stage_08(slug=slug)


def _node_stage_09a(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    return run_stage_09a(slug=slug)


def _node_stage_09b(state: PipelineState) -> dict[str, Any]:
    slug = state["persona_slug"]
    return run_stage_09b(slug=slug)


def build_pipeline(slug: str):
    """Compile a LangGraph pipeline targeted at one persona's working dir."""
    g: StateGraph = StateGraph(PipelineState)
    g.add_node("stage_00_spec", _node_stage_00)
    g.add_node("stage_01a_life_context", _node_stage_01a)
    g.add_node("stage_01b_character_sketch", _node_stage_01b)
    g.add_node("stage_01c_judgment", _node_stage_01c)
    g.add_node("stage_01d_profile", _node_stage_01d)
    g.add_node("stage_02_cast", _node_stage_02)
    g.add_node("stage_03_archetypes", _node_stage_03)
    g.add_node("stage_04_channels", _node_stage_04)
    g.add_node("stage_05_storylines", _node_stage_05)
    g.add_node("stage_06_window_plan", _node_stage_06)
    g.add_node("stage_07_living_day", _node_stage_07)
    g.add_node("stage_08_artifact_emission", _node_stage_08)
    g.add_node("stage_09a_validation", _node_stage_09a)
    g.add_node("stage_09b_assembly", _node_stage_09b)

    g.add_edge(START, "stage_00_spec")
    g.add_edge("stage_00_spec", "stage_01a_life_context")
    g.add_edge("stage_01a_life_context", "stage_01b_character_sketch")
    g.add_edge("stage_01b_character_sketch", "stage_01c_judgment")
    g.add_edge("stage_01c_judgment", "stage_01d_profile")
    g.add_edge("stage_01d_profile", "stage_02_cast")
    g.add_edge("stage_02_cast", "stage_03_archetypes")
    g.add_edge("stage_03_archetypes", "stage_04_channels")
    g.add_edge("stage_04_channels", "stage_05_storylines")
    g.add_edge("stage_05_storylines", "stage_06_window_plan")
    g.add_edge("stage_06_window_plan", "stage_07_living_day")
    g.add_edge("stage_07_living_day", "stage_08_artifact_emission")
    g.add_edge("stage_08_artifact_emission", "stage_09a_validation")
    g.add_edge("stage_09a_validation", "stage_09b_assembly")
    g.add_edge("stage_09b_assembly", END)

    checkpoint_path = persona_dir(slug) / ".langgraph_checkpoint.db"
    persona_dir(slug).mkdir(parents=True, exist_ok=True)
    saver_ctx = SqliteSaver.from_conn_string(str(checkpoint_path))
    return g, saver_ctx
