"""Stage 2 structured tool: ``add_cast_member``.

Each call INSERTs one row into ``persona.db.cast``. Idempotent on ``cast_id``
(re-running Stage 2 overwrites in place).
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from claude_agent_sdk import tool
from sqlmodel import Session

from ..db import engine_for
from ..models import Cast

VALID_TIERS = {"p0", "p1", "p2", "p3", "p4"}


def build_add_cast_member(*, slug: str):
    """Factory: returns an ``SdkMcpTool`` bound to one persona slug."""

    @tool(
        "add_cast_member",
        "Record a cast member's ID, display name, signal tier, and a one-line role brief. "
        "Call once per cast member whose name appears in cast.md. Tier must be one of "
        "p0 (closest), p1, p2, p3, p4 (most distant/ambient).",
        {
            "cast_id": Annotated[str, "Stable lowercase identifier, e.g. 'marcus_reilly'."],
            "display_name": Annotated[str, "Full display name, e.g. 'Marcus Reilly'."],
            "signal_tier": Annotated[str, "One of: p0 | p1 | p2 | p3 | p4."],
            "role_brief": Annotated[str, "One-line role/relationship summary, e.g. 'lead Series A investor (Horizon)'."],
        },
    )
    async def add_cast_member(args: dict[str, Any]) -> dict[str, Any]:
        tier = args["signal_tier"].lower()
        if tier not in VALID_TIERS:
            return _err(
                f"signal_tier must be one of p0|p1|p2|p3|p4, got '{args['signal_tier']}'"
            )

        cast_id = args["cast_id"]
        engine = engine_for(slug)
        with Session(engine) as session:
            existing = session.get(Cast, cast_id)
            if existing is None:
                session.add(
                    Cast(
                        cast_id=cast_id,
                        display_name=args["display_name"],
                        signal_tier=tier,
                        role_brief=args.get("role_brief"),
                    )
                )
            else:
                existing.display_name = args["display_name"]
                existing.signal_tier = tier
                existing.role_brief = args.get("role_brief")
                session.add(existing)
            session.commit()

        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {"ok": True, "cast_id": cast_id, "signal_tier": tier}
                    ),
                }
            ]
        }

    return add_cast_member


def _err(msg: str) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps({"ok": False, "error": msg})}],
        "isError": True,
    }
