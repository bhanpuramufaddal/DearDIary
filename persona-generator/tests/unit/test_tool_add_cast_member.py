"""`add_cast_member` tool: valid insert, tier validation, idempotency."""

import asyncio
import json

from sqlmodel import Session, select

from persona_generator.db import engine_for, init_db
from persona_generator.models import Cast
from persona_generator.tools.cast import build_add_cast_member


def _call(tool, args: dict) -> dict:
    return asyncio.run(tool.handler(args))


def test_insert_row(temp_data_root):
    init_db("test_slug")
    tool = build_add_cast_member(slug="test_slug")
    result = _call(
        tool,
        {
            "cast_id": "marcus_reilly",
            "display_name": "Marcus Reilly",
            "signal_tier": "p0",
            "role_brief": "lead Series A investor",
        },
    )
    assert result.get("isError") is not True
    body = json.loads(result["content"][0]["text"])
    assert body["ok"] is True
    assert body["cast_id"] == "marcus_reilly"

    with Session(engine_for("test_slug")) as session:
        row = session.get(Cast, "marcus_reilly")
        assert row is not None
        assert row.display_name == "Marcus Reilly"
        assert row.signal_tier == "p0"
        assert row.role_brief == "lead Series A investor"


def test_signal_tier_validation(temp_data_root):
    init_db("test_slug")
    tool = build_add_cast_member(slug="test_slug")
    result = _call(
        tool,
        {
            "cast_id": "x",
            "display_name": "X",
            "signal_tier": "Q9",  # invalid
            "role_brief": "—",
        },
    )
    assert result.get("isError") is True


def test_tier_case_normalized(temp_data_root):
    init_db("test_slug")
    tool = build_add_cast_member(slug="test_slug")
    _call(
        tool,
        {
            "cast_id": "ben_n",
            "display_name": "Ben N",
            "signal_tier": "P1",  # uppercase
            "role_brief": "cofounder",
        },
    )
    with Session(engine_for("test_slug")) as session:
        row = session.get(Cast, "ben_n")
        assert row is not None
        assert row.signal_tier == "p1"


def test_idempotent_overwrite(temp_data_root):
    init_db("test_slug")
    tool = build_add_cast_member(slug="test_slug")
    args = {
        "cast_id": "marcus_reilly",
        "display_name": "Marcus Reilly",
        "signal_tier": "p0",
        "role_brief": "lead Series A investor",
    }
    _call(tool, args)
    args["role_brief"] = "lead Series A investor (Horizon Partners)"
    _call(tool, args)
    with Session(engine_for("test_slug")) as session:
        rows = session.exec(select(Cast)).all()
        assert len(rows) == 1
        assert rows[0].role_brief == "lead Series A investor (Horizon Partners)"
