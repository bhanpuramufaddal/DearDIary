"""`add_initial_calendar_event` tool: valid insert, idempotency, JSON validation."""

import asyncio
import json

from sqlmodel import Session, select

from persona_generator.db import engine_for, init_db
from persona_generator.models import InitialCalendarEvent
from persona_generator.tools.calendar_seed import build_add_initial_calendar_event


def _call(tool, args: dict) -> dict:
    return asyncio.run(tool.handler(args))


def test_insert_recurring_event(temp_data_root):
    init_db("test_slug")
    tool = build_add_initial_calendar_event(slug="test_slug")
    result = _call(
        tool,
        {
            "event_id": "wkly_naveen_1on1",
            "title": "Naveen 1:1",
            "start_iso": "2026-04-21T10:00:00-07:00",
            "end_iso": "2026-04-21T10:30:00-07:00",
            "attendees_json": '["naveen@plumb.so","avery@plumb.so"]',
            "recurring_rrule": "FREQ=WEEKLY;BYDAY=TU",
            "calendar_id": "primary",
        },
    )
    assert result.get("isError") is not True
    body = json.loads(result["content"][0]["text"])
    assert body == {"ok": True, "event_id": "wkly_naveen_1on1"}

    with Session(engine_for("test_slug")) as session:
        row = session.get(InitialCalendarEvent, "wkly_naveen_1on1")
        assert row is not None
        assert row.recurring_rrule == "FREQ=WEEKLY;BYDAY=TU"
        assert row.calendar_id == "primary"


def test_insert_one_off_no_rrule(temp_data_root):
    init_db("test_slug")
    tool = build_add_initial_calendar_event(slug="test_slug")
    _call(
        tool,
        {
            "event_id": "board_may_14",
            "title": "Board meeting",
            "start_iso": "2026-05-14T14:00:00-07:00",
            "end_iso": "2026-05-14T16:00:00-07:00",
            "attendees_json": "[]",
            "recurring_rrule": None,
            "calendar_id": "primary",
        },
    )
    with Session(engine_for("test_slug")) as session:
        row = session.get(InitialCalendarEvent, "board_may_14")
        assert row is not None
        assert row.recurring_rrule is None


def test_invalid_attendees_json_rejected(temp_data_root):
    init_db("test_slug")
    tool = build_add_initial_calendar_event(slug="test_slug")
    result = _call(
        tool,
        {
            "event_id": "x",
            "title": "x",
            "start_iso": "2026-04-21T10:00:00-07:00",
            "end_iso": "2026-04-21T10:30:00-07:00",
            "attendees_json": "not-json",  # bad
            "recurring_rrule": None,
            "calendar_id": "primary",
        },
    )
    assert result.get("isError") is True


def test_idempotent_overwrite(temp_data_root):
    init_db("test_slug")
    tool = build_add_initial_calendar_event(slug="test_slug")
    args = {
        "event_id": "wkly_naveen_1on1",
        "title": "Naveen 1:1",
        "start_iso": "2026-04-21T10:00:00-07:00",
        "end_iso": "2026-04-21T10:30:00-07:00",
        "attendees_json": "[]",
        "recurring_rrule": "FREQ=WEEKLY;BYDAY=TU",
        "calendar_id": "primary",
    }
    _call(tool, args)
    args["title"] = "Naveen 1:1 (renamed)"
    _call(tool, args)
    with Session(engine_for("test_slug")) as session:
        rows = session.exec(select(InitialCalendarEvent)).all()
        assert len(rows) == 1
        assert rows[0].title == "Naveen 1:1 (renamed)"
