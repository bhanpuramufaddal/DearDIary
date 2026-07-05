"""Stage 6 — Window Plan.

Reads upstream foundation + Stage 5 storylines and:
  - writes ``internal/window_plan.md`` (5-week prose outline)
  - INSERTs ≥ 5 rows into ``initial_calendar_events`` (the Day 1 standing rhythm)

Stage 7 reads both: the prose for week-shape orientation, the seeded events
for the starting calendar state.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from ..agent_runtime import DEFAULT_MODEL, RunResult, run_agent, verify_file_exists
from ..db import engine_for, persona_dir
from ..models import InitialCalendarEvent
from ..tools.calendar_seed import build_add_initial_calendar_event
from ._common import default_render_vars, ensure_persona_spec_visible, load_stage_prompt, render

STAGE_ID = "stage_06_window_plan"
EXPECTED_FILE = "internal/window_plan.md"
MIN_FILE_CHARS = 3500
MIN_INITIAL_EVENTS = 12  # raised from 5 — a real workday has 2–3 recurring meetings as baseline; under-seeded calendars cause Stage 7 to render sparse days. Floor only; the prompt targets 15–30.
REQUIRED_HEADERS = (
    "## Orientation",
    "## Week 0",
    "## Week 1",
    "## Week 2",
    "## Week 3",
    "## Week 4",
    "## Arc resolutions",
)


def _verifier(slug: str) -> tuple[bool, list[str]]:
    ok, missing = verify_file_exists(slug, EXPECTED_FILE)
    if not ok:
        return False, missing

    body = (persona_dir(slug) / EXPECTED_FILE).read_text(encoding="utf-8")
    if len(body) < MIN_FILE_CHARS:
        return False, [f"{EXPECTED_FILE} too short ({len(body)} chars; want ≥ {MIN_FILE_CHARS})"]

    missing_headers = [h for h in REQUIRED_HEADERS if h not in body]
    if missing_headers:
        return False, [f"{EXPECTED_FILE} missing required headers: {missing_headers}"]

    with Session(engine_for(slug)) as session:
        rows = session.exec(select(InitialCalendarEvent)).all()
    if len(rows) < MIN_INITIAL_EVENTS:
        return False, [
            f"initial_calendar_events has {len(rows)} rows; need ≥ {MIN_INITIAL_EVENTS}. "
            "Add weekly 1:1s, all-hands, board cadence, partner/family blocks."
        ]
    if not any(r.recurring_rrule for r in rows):
        return False, [
            "Zero recurring events seeded. A persona's standing rhythm always includes at "
            "least one weekly recurrence (1:1, all-hands, family block). Add an RRULE row."
        ]
    return True, []


def run_stage_06(*, slug: str) -> dict[str, Any]:
    ensure_persona_spec_visible(slug)
    system_prompt, user_template = load_stage_prompt(STAGE_ID)
    vars_ = default_render_vars(slug)
    system_prompt = render(system_prompt, **vars_)
    user_prompt = render(user_template, **vars_)

    tool_fn = build_add_initial_calendar_event(slug=slug)

    result: RunResult = run_agent(
        stage_id=STAGE_ID,
        slug=slug,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        structured_tools=[tool_fn],
        allowed_file_tools=("Read", "Write", "Edit", "Glob"),
        verifier=_verifier,
        model=DEFAULT_MODEL,
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

    with Session(engine_for(slug)) as session:
        n_events = len(session.exec(select(InitialCalendarEvent)).all())

    return {
        "completed_stages": [STAGE_ID],
        "stage_outputs": {
            STAGE_ID: [EXPECTED_FILE, f"initial_calendar_events: {n_events} rows"]
        },
    }
