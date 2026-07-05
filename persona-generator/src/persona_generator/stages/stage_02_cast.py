"""Stage 2 — Cast.

Agent reads upstream foundation, writes ``internal/cast.md`` (P0–P1 get
multi-paragraph profiles; P2 one paragraph; P3–P4 listed by name + role),
AND calls ``add_cast_member`` once per cast member to populate the `cast` table.

Verifier passes when: cast.md ≥ MIN_CHARS, ≥ MIN_ROWS rows in `cast`, and at
least one row each at tiers p0 and p1.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from ..agent_runtime import run_agent, verify_file_exists
from ..db import engine_for, persona_dir
from ..models import Cast
from ..tools.cast import build_add_cast_member
from ._common import (
    default_render_vars,
    ensure_persona_spec_visible,
    load_stage_prompt,
    render,
)

STAGE_ID = "stage_02_cast"
OUTPUT = "internal/cast.md"
MIN_CHARS = 6000
MIN_ROWS = 5


def _verifier(slug: str) -> tuple[bool, list[str]]:
    file_ok, missing = verify_file_exists(slug, OUTPUT)
    if not file_ok:
        return False, missing
    body = (persona_dir(slug) / OUTPUT).read_text(encoding="utf-8")
    if len(body) < MIN_CHARS:
        return False, [f"{OUTPUT} too short ({len(body)} chars; want ≥ {MIN_CHARS})"]
    with Session(engine_for(slug)) as session:
        rows = session.exec(select(Cast)).all()
    if len(rows) < MIN_ROWS:
        return False, [f"cast table has {len(rows)} rows; want ≥ {MIN_ROWS}"]
    tiers = {r.signal_tier for r in rows}
    if "p0" not in tiers:
        return False, ["cast has no p0 entries"]
    if "p1" not in tiers:
        return False, ["cast has no p1 entries"]
    return True, []


def run_stage_02(*, slug: str) -> dict[str, Any]:
    ensure_persona_spec_visible(slug)

    system_prompt, user_template = load_stage_prompt(STAGE_ID)
    vars_ = default_render_vars(slug)
    system_prompt = render(system_prompt, **vars_)
    user_prompt = render(user_template or _default_user(), **vars_)

    tool_fn = build_add_cast_member(slug=slug)

    result = run_agent(
        stage_id=STAGE_ID,
        slug=slug,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        structured_tools=[tool_fn],
        allowed_file_tools=["Read", "Write", "Edit", "Glob", "WebSearch", "WebFetch"],
        verifier=_verifier,
    )

    if not result.success:
        return {
            "errors": [
                {
                    "stage": STAGE_ID,
                    "message": result.error
                    or "missing outputs: " + ", ".join(result.missing_outputs),
                    "retry_count": 0,
                }
            ]
        }
    return {
        "completed_stages": [STAGE_ID],
        "stage_outputs": {STAGE_ID: [OUTPUT, "cast table"]},
    }


def _default_user() -> str:
    return (
        "Working directory: `data/{persona_slug}/`. Today is {today_human} ({iso_today}). "
        "Produce `internal/cast.md` per your instructions, and call `add_cast_member` "
        "once per named cast member (P0–P4). The window is {window_start_iso} → {window_end_iso}."
    )
