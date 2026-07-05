"""Stage 6 structured tool: ``add_initial_calendar_event``.

INSERTs one row into ``initial_calendar_events`` per call. These are the
standing meetings + already-on-the-books one-offs that exist on Day 1 at
00:00 before any storyline action. Stage 7 layers ``calendar_ops`` on top.

Idempotent on ``event_id`` — re-running Stage 6 overwrites in place.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from claude_agent_sdk import tool
from sqlmodel import Session

from ..db import engine_for
from ..models import InitialCalendarEvent


def build_add_initial_calendar_event(*, slug: str):
    @tool(
        "add_initial_calendar_event",
        "Seed one event on the persona's calendar at Day 1, 00:00. Use for standing "
        "meetings (weekly 1:1s, monthly board, recurring all-hands), already-on-the-books "
        "one-offs (an offsite, a doctor appointment, an anniversary), or pickup blocks. "
        "Do NOT use this for storyline-driven events (a climactic investor pitch) — those "
        "are Stage 7 calendar_ops.",
        {
            "event_id": Annotated[str, "Stable snake_case id, e.g. 'wkly_naveen_1on1', 'board_q2_review'."],
            "title": Annotated[str, "Human-readable title, e.g. 'Naveen 1:1', 'Q2 Board Review'."],
            "start_iso": Annotated[str, "First-occurrence start in ISO 8601 with TZ offset, e.g. '2026-04-21T10:00:00-07:00'."],
            "end_iso": Annotated[str, "First-occurrence end in same format."],
            "attendees_json": Annotated[str, "JSON array string of email-shaped attendee addresses, e.g. '[\"naveen@plumb.so\",\"avery@plumb.so\"]'. Use '[]' for solo blocks."],
            "recurring_rrule": Annotated[str | None, "RFC 5545 RRULE for recurring events (e.g. 'FREQ=WEEKLY;BYDAY=TU'), or null for one-offs."],
            "calendar_id": Annotated[str, "Calendar identifier; default 'primary'."],
        },
    )
    async def add_initial_calendar_event(args: dict[str, Any]) -> dict[str, Any]:
        eid = args["event_id"]
        # Validate attendees_json parses
        try:
            json.loads(args["attendees_json"])
        except (json.JSONDecodeError, TypeError) as exc:
            return _err(f"attendees_json must be a JSON array string, got: {exc}")

        with Session(engine_for(slug)) as session:
            existing = session.get(InitialCalendarEvent, eid)
            if existing is None:
                session.add(
                    InitialCalendarEvent(
                        event_id=eid,
                        title=args["title"],
                        start_iso=args["start_iso"],
                        end_iso=args["end_iso"],
                        attendees_json=args.get("attendees_json"),
                        recurring_rrule=args.get("recurring_rrule"),
                        calendar_id=args.get("calendar_id", "primary"),
                    )
                )
            else:
                existing.title = args["title"]
                existing.start_iso = args["start_iso"]
                existing.end_iso = args["end_iso"]
                existing.attendees_json = args.get("attendees_json")
                existing.recurring_rrule = args.get("recurring_rrule")
                existing.calendar_id = args.get("calendar_id", "primary")
                session.add(existing)
            session.commit()

        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps({"ok": True, "event_id": eid}),
                }
            ]
        }

    return add_initial_calendar_event


def _err(msg: str) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps({"ok": False, "error": msg})}],
        "isError": True,
    }
