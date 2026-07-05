"""RC-9 regression: ``add_cast_member`` previously read ``row.cast_id`` AFTER
``session.commit()``, which detaches the SQLAlchemy instance and raises
``DetachedInstanceError``. The fix is to read the id from ``args["cast_id"]``
before the session ever opens. This test pins that contract: the JSON body the
tool returns must be readable without ever touching a detached SQLAlchemy
attribute, on both the insert path and the update (idempotent) path."""

from __future__ import annotations

import asyncio
import json

from persona_generator.db import init_db
from persona_generator.tools.cast import build_add_cast_member


def _call(tool, args: dict) -> dict:
    return asyncio.run(tool.handler(args))


def test_cast_id_in_response_is_from_args_not_orm_row_insert(temp_data_root):
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
    assert body == {"ok": True, "cast_id": "marcus_reilly", "signal_tier": "p0"}


def test_cast_id_in_response_is_from_args_not_orm_row_update(temp_data_root):
    init_db("test_slug")
    tool = build_add_cast_member(slug="test_slug")
    args = {
        "cast_id": "jen_wong",
        "display_name": "Jen Wong",
        "signal_tier": "p1",
        "role_brief": "Bessemer partner",
    }
    _call(tool, args)
    args["role_brief"] = "Bessemer partner (lead diligence)"
    result = _call(tool, args)
    assert result.get("isError") is not True
    body = json.loads(result["content"][0]["text"])
    assert body["cast_id"] == "jen_wong"
    assert body["signal_tier"] == "p1"
