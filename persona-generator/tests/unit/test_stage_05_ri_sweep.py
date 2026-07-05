"""Stage 5's referential-integrity sweep catches dangling references."""

import asyncio

from persona_generator.db import init_db
from persona_generator.stages.stage_05_storylines import _ri_violations
from persona_generator.tools.storyline import (
    build_add_storyline,
    build_declare_digest_moment,
    build_declare_noise_event,
    build_declare_planned_artifact,
)


def _c(tool, args):
    return asyncio.run(tool.handler(args))


def _seed_minimal(slug: str) -> None:
    """One storyline, one planned artifact, one moment, no violations."""
    _c(build_add_storyline(slug=slug), {
        "storyline_id": "sl_1",
        "display_name": "X",
        "arc_path": "internal/storylines/sl_1/arc.md",
    })
    _c(build_declare_planned_artifact(slug=slug), {
        "artifact_id": "a1",
        "storyline_id": "sl_1",
        "target_render_date": "2026-05-08",
        "kind": "email",
        "content_sketch": None,
        "is_decoy": False,
    })
    _c(build_declare_digest_moment(slug=slug), {
        "moment_id": "m1",
        "storyline_id": "sl_1",
        "target_morning": "2026-05-12",
        "section": "urgent_todo",
        "priority": "P0",
        "action_class": "decide",
        "rationale": "x",
        "supporting_artifact_ids": ["a1"],
    })


def test_ri_clean_state(temp_data_root):
    init_db("s")
    _seed_minimal("s")
    assert _ri_violations("s") == []


def test_ri_catches_unknown_supporting_artifact_id(temp_data_root):
    init_db("s")
    _c(build_add_storyline(slug="s"), {
        "storyline_id": "sl_1",
        "display_name": "X",
        "arc_path": "internal/storylines/sl_1/arc.md",
    })
    # Declare a moment that references an artifact we never declared
    _c(build_declare_digest_moment(slug="s"), {
        "moment_id": "m1",
        "storyline_id": "sl_1",
        "target_morning": "2026-05-12",
        "section": "urgent_todo",
        "priority": "P0",
        "action_class": "decide",
        "rationale": "x",
        "supporting_artifact_ids": ["GHOST_ARTIFACT"],
    })
    violations = _ri_violations("s")
    assert len(violations) == 1
    assert "GHOST_ARTIFACT" in violations[0]


def test_declare_noise_event_rejects_unknown_target_moment(temp_data_root):
    """The tool itself catches dangling target_moment_ids (FK would otherwise crash)."""
    init_db("s")
    _seed_minimal("s")
    res = _c(build_declare_noise_event(slug="s"), {
        "noise_id": "n1",
        "storyline_id": "sl_1",
        "occurrence_date": "2026-05-08",
        "triggers_artifact_id": None,
        "effects": [
            {"target_moment_id": "GHOST_MOMENT", "effect_kind": "SHIFTED", "effective_from": "2026-05-08", "new_target_morning": "2026-05-15"},
        ],
    })
    assert res.get("isError") is True
    assert "GHOST_MOMENT" in res["content"][0]["text"]


def test_ri_catches_storyline_with_zero_moments(temp_data_root):
    init_db("s")
    # Two storylines; only one has a moment
    _c(build_add_storyline(slug="s"), {"storyline_id": "sl_1", "display_name": "X", "arc_path": "a"})
    _c(build_add_storyline(slug="s"), {"storyline_id": "sl_2", "display_name": "Y", "arc_path": "b"})
    _c(build_declare_planned_artifact(slug="s"), {
        "artifact_id": "a1", "storyline_id": "sl_1",
        "target_render_date": "2026-05-08", "kind": "email",
        "content_sketch": None, "is_decoy": False,
    })
    _c(build_declare_digest_moment(slug="s"), {
        "moment_id": "m1", "storyline_id": "sl_1",
        "target_morning": "2026-05-12", "section": "urgent_todo",
        "priority": "P0", "action_class": "decide", "rationale": "x",
        "supporting_artifact_ids": ["a1"],
    })
    violations = _ri_violations("s")
    assert any("sl_2" in v and "zero declared_moments" in v for v in violations)
