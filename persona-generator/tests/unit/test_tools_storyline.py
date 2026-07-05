"""Stage 5 structured tools — round-trips, validation, idempotency."""

import asyncio
import json

from sqlmodel import Session, select

from persona_generator.db import engine_for, init_db
from persona_generator.models import (
    DeclaredMoment,
    MomentSupportingArtifact,
    NoiseEffect,
    NoiseEvent,
    PlannedArtifact,
    Storyline,
)
from persona_generator.tools.storyline import (
    build_add_storyline,
    build_declare_digest_moment,
    build_declare_noise_event,
    build_declare_planned_artifact,
)


def _call(tool, args: dict) -> dict:
    return asyncio.run(tool.handler(args))


def _seed_storyline(slug: str, sid: str = "sl_1") -> None:
    tool = build_add_storyline(slug=slug)
    _call(
        tool,
        {
            "storyline_id": sid,
            "display_name": "Test Storyline",
            "arc_path": f"internal/storylines/{sid}/arc.md",
        },
    )


# ---------- add_storyline ----------


def test_add_storyline_inserts_row(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    with Session(engine_for("s")) as session:
        row = session.get(Storyline, "sl_1")
        assert row is not None
        assert row.display_name == "Test Storyline"


def test_add_storyline_idempotent(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    tool = build_add_storyline(slug="s")
    _call(
        tool,
        {
            "storyline_id": "sl_1",
            "display_name": "Renamed Storyline",
            "arc_path": "internal/storylines/sl_1/arc.md",
        },
    )
    with Session(engine_for("s")) as session:
        rows = session.exec(select(Storyline)).all()
        assert len(rows) == 1
        assert rows[0].display_name == "Renamed Storyline"


# ---------- declare_planned_artifact ----------


def test_planned_artifact_round_trip(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    tool = build_declare_planned_artifact(slug="s")
    res = _call(
        tool,
        {
            "artifact_id": "a1",
            "storyline_id": "sl_1",
            "target_render_date": "2026-05-10",
            "kind": "email",
            "content_sketch": "Marcus emails about IC agenda.",
            "is_decoy": False,
        },
    )
    assert res.get("isError") is not True
    with Session(engine_for("s")) as session:
        row = session.get(PlannedArtifact, "a1")
        assert row is not None
        assert row.kind == "email"
        assert row.is_decoy == 0


def test_planned_artifact_invalid_kind_rejected(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    tool = build_declare_planned_artifact(slug="s")
    res = _call(
        tool,
        {
            "artifact_id": "a1",
            "storyline_id": "sl_1",
            "target_render_date": "2026-05-10",
            "kind": "tweet",  # invalid
            "content_sketch": None,
            "is_decoy": False,
        },
    )
    assert res.get("isError") is True


def test_planned_artifact_unknown_storyline_rejected(temp_data_root):
    init_db("s")
    # NO seed
    tool = build_declare_planned_artifact(slug="s")
    res = _call(
        tool,
        {
            "artifact_id": "a1",
            "storyline_id": "missing",
            "target_render_date": "2026-05-10",
            "kind": "email",
            "content_sketch": None,
            "is_decoy": False,
        },
    )
    assert res.get("isError") is True


# ---------- declare_digest_moment ----------


def test_digest_moment_with_supporting_artifacts(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    pa = build_declare_planned_artifact(slug="s")
    _call(pa, {"artifact_id": "a1", "storyline_id": "sl_1", "target_render_date": "2026-05-10", "kind": "email", "content_sketch": None, "is_decoy": False})
    _call(pa, {"artifact_id": "a2", "storyline_id": "sl_1", "target_render_date": "2026-05-10", "kind": "email", "content_sketch": None, "is_decoy": False})
    _call(pa, {"artifact_id": "a3", "storyline_id": "sl_1", "target_render_date": "2026-05-11", "kind": "email", "content_sketch": None, "is_decoy": False})

    dm = build_declare_digest_moment(slug="s")
    res = _call(
        dm,
        {
            "moment_id": "m1",
            "storyline_id": "sl_1",
            "target_morning": "2026-05-12",
            "section": "urgent_todo",
            "priority": "P0",
            "action_class": "decide",
            "rationale": "Need to pick the term sheet today.",
            "supporting_artifact_ids": ["a1", "a2", "a3"],
        },
    )
    assert res.get("isError") is not True
    body = json.loads(res["content"][0]["text"])
    assert body["supporting_count"] == 3

    with Session(engine_for("s")) as session:
        links = session.exec(select(MomentSupportingArtifact).where(MomentSupportingArtifact.moment_id == "m1")).all()
        assert len(links) == 3


def test_digest_moment_invalid_section_rejected(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    dm = build_declare_digest_moment(slug="s")
    res = _call(
        dm,
        {
            "moment_id": "m1",
            "storyline_id": "sl_1",
            "target_morning": "2026-05-12",
            "section": "bogus_section",
            "priority": "P0",
            "action_class": "decide",
            "rationale": "x",
            "supporting_artifact_ids": [],
        },
    )
    assert res.get("isError") is True


def test_digest_moment_invalid_priority_rejected(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    dm = build_declare_digest_moment(slug="s")
    res = _call(
        dm,
        {
            "moment_id": "m1",
            "storyline_id": "sl_1",
            "target_morning": "2026-05-12",
            "section": "urgent_todo",
            "priority": "P9",  # invalid
            "action_class": "decide",
            "rationale": "x",
            "supporting_artifact_ids": [],
        },
    )
    assert res.get("isError") is True


def test_digest_moment_rewriting_replaces_supporting_links(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    pa = build_declare_planned_artifact(slug="s")
    for aid in ("a1", "a2", "a3"):
        _call(pa, {"artifact_id": aid, "storyline_id": "sl_1", "target_render_date": "2026-05-10", "kind": "email", "content_sketch": None, "is_decoy": False})
    dm = build_declare_digest_moment(slug="s")
    base = {
        "moment_id": "m1",
        "storyline_id": "sl_1",
        "target_morning": "2026-05-12",
        "section": "urgent_todo",
        "priority": "P0",
        "action_class": "decide",
        "rationale": "x",
    }
    _call(dm, {**base, "supporting_artifact_ids": ["a1", "a2"]})
    _call(dm, {**base, "supporting_artifact_ids": ["a3"]})  # replaces, doesn't append
    with Session(engine_for("s")) as session:
        links = session.exec(select(MomentSupportingArtifact).where(MomentSupportingArtifact.moment_id == "m1")).all()
        assert {l.artifact_id for l in links} == {"a3"}


# ---------- declare_noise_event ----------


def test_noise_event_with_effects(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    pa = build_declare_planned_artifact(slug="s")
    _call(pa, {"artifact_id": "a1", "storyline_id": "sl_1", "target_render_date": "2026-05-08", "kind": "email", "content_sketch": None, "is_decoy": False})
    dm = build_declare_digest_moment(slug="s")
    _call(
        dm,
        {
            "moment_id": "m1",
            "storyline_id": "sl_1",
            "target_morning": "2026-05-13",
            "section": "urgent_todo",
            "priority": "P0",
            "action_class": "decide",
            "rationale": "x",
            "supporting_artifact_ids": ["a1"],
        },
    )
    ne = build_declare_noise_event(slug="s")
    res = _call(
        ne,
        {
            "noise_id": "n1",
            "storyline_id": "sl_1",
            "occurrence_date": "2026-05-08",
            "triggers_artifact_id": "a1",
            "effects": [
                {"target_moment_id": "m1", "effect_kind": "SHIFTED", "effective_from": "2026-05-08", "new_target_morning": "2026-05-16"},
                {"target_moment_id": "m1", "effect_kind": "MODIFIED", "effective_from": "2026-05-08", "new_rationale": "shifted; agenda revised"},
            ],
        },
    )
    assert res.get("isError") is not True
    body = json.loads(res["content"][0]["text"])
    assert body["effect_count"] == 2
    with Session(engine_for("s")) as session:
        effects = session.exec(select(NoiseEffect).where(NoiseEffect.noise_id == "n1")).all()
        assert len(effects) == 2
        kinds = {e.effect_kind for e in effects}
        assert kinds == {"SHIFTED", "MODIFIED"}


def test_noise_effect_invalid_kind_rejected(temp_data_root):
    init_db("s")
    _seed_storyline("s")
    ne = build_declare_noise_event(slug="s")
    res = _call(
        ne,
        {
            "noise_id": "n1",
            "storyline_id": "sl_1",
            "occurrence_date": "2026-05-08",
            "triggers_artifact_id": None,
            "effects": [
                {"target_moment_id": "m1", "effect_kind": "WHOOPS", "effective_from": "2026-05-08"},
            ],
        },
    )
    assert res.get("isError") is True
