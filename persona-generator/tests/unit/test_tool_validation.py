"""Stage 9a validation tools: pass / fail / correct."""

import asyncio
import json

from sqlmodel import Session

from persona_generator.db import engine_for, init_db
from persona_generator.models import DeclaredMoment, Storyline, ValidationLog
from persona_generator.tools.validation import (
    build_validation_correct,
    build_validation_fail,
    build_validation_pass,
)


def _call(tool, args: dict) -> dict:
    return asyncio.run(tool.handler(args))


def _seed_moment(slug: str, moment_id: str) -> None:
    with Session(engine_for(slug)) as session:
        if session.get(Storyline, "s1") is None:
            session.add(Storyline(storyline_id="s1", display_name="S1", arc_path="x"))
            session.commit()
    with Session(engine_for(slug)) as session:
        session.add(
            DeclaredMoment(
                moment_id=moment_id,
                storyline_id="s1",
                target_morning="2026-05-21",
                section="urgent_todo",
                priority="P1",
                action_class="reply_short",
                rationale="x",
            )
        )
        session.commit()


def test_validation_pass(temp_data_root):
    init_db("test_slug")
    _seed_moment("test_slug", "m1")
    tool = build_validation_pass(slug="test_slug")
    result = _call(tool, {"moment_id": "m1", "justification": "matches msg_x"})
    assert result.get("isError") is not True
    with Session(engine_for("test_slug")) as session:
        row = session.get(ValidationLog, "m1")
        assert row is not None
        assert row.status == "pass"


def test_validation_fail_with_severity(temp_data_root):
    init_db("test_slug")
    _seed_moment("test_slug", "m2")
    tool = build_validation_fail(slug="test_slug")
    result = _call(
        tool,
        {"moment_id": "m2", "reason": "action already taken on day M-3", "severity": "major"},
    )
    assert result.get("isError") is not True
    with Session(engine_for("test_slug")) as session:
        row = session.get(ValidationLog, "m2")
        assert row.status == "fail"
        assert row.severity == "major"


def test_validation_fail_rejects_bad_severity(temp_data_root):
    init_db("test_slug")
    _seed_moment("test_slug", "m3")
    tool = build_validation_fail(slug="test_slug")
    result = _call(
        tool, {"moment_id": "m3", "reason": "x", "severity": "catastrophic"}
    )
    assert result.get("isError") is True


def test_validation_correct(temp_data_root):
    init_db("test_slug")
    _seed_moment("test_slug", "m4")
    tool = build_validation_correct(slug="test_slug")
    result = _call(
        tool,
        {
            "moment_id": "m4",
            "corrected_rationale": "Deadline is Friday May 23, not today.",
            "corrected_priority": "P2",
            "justification": "Supporting artifact stated 'EOW' not 'today'.",
        },
    )
    assert result.get("isError") is not True
    with Session(engine_for("test_slug")) as session:
        row = session.get(ValidationLog, "m4")
        assert row.status == "correct"
        assert row.corrected_priority == "P2"


def test_validation_correct_rejects_unknown_priority(temp_data_root):
    init_db("test_slug")
    _seed_moment("test_slug", "m5")
    tool = build_validation_correct(slug="test_slug")
    result = _call(
        tool,
        {
            "moment_id": "m5",
            "corrected_rationale": "x",
            "corrected_priority": "P9",
            "justification": "x",
        },
    )
    assert result.get("isError") is True


def test_validation_pass_unknown_moment(temp_data_root):
    init_db("test_slug")
    tool = build_validation_pass(slug="test_slug")
    result = _call(tool, {"moment_id": "never_declared", "justification": "x"})
    assert result.get("isError") is True


def test_validation_upserts_in_place(temp_data_root):
    """Pass then fail; the row should reflect the latest verdict."""
    init_db("test_slug")
    _seed_moment("test_slug", "m6")
    p = build_validation_pass(slug="test_slug")
    f = build_validation_fail(slug="test_slug")
    _call(p, {"moment_id": "m6", "justification": "x"})
    _call(f, {"moment_id": "m6", "reason": "actually stale", "severity": "minor"})
    with Session(engine_for("test_slug")) as session:
        row = session.get(ValidationLog, "m6")
        assert row.status == "fail"
        assert row.severity == "minor"
