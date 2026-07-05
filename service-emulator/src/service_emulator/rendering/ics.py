"""Replay ``initial_calendar_events`` + ``calendar_ops`` into iCalendar (.ics) state as of a given moment.

The persona-generator stores calendar state in two parts:
  1. ``initial_calendar_events`` — what exists at Day 1, 00:00 (recurring rules + one-offs).
  2. ``calendar_ops`` — chronological log of add/move/cancel/accept/decline operations.

To answer "what's the calendar look like at as_of=T?", we walk the ops with
``ts_iso ≤ T`` and fold them on top of the initial set. The result is a
collection of VEVENT entries that a digest agent (or a real iCal client) can
treat as the persona's current calendar.

This is intentionally simple — we don't expand RRULE expansion into individual
event instances; consumers that need instance-level expansion can compute
recurrences from the VEVENT + RRULE themselves (the dateutil.rrule pattern).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Iterable

from persona_generator.models import CalendarOp, InitialCalendarEvent


def _vevent(uid: str, *, title: str, start_iso: str, end_iso: str, attendees_json: str | None = None, recurring_rrule: str | None = None, status: str | None = None, sequence: int = 0) -> str:
    """Build one VEVENT block."""
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTART:{_to_ics_dt(start_iso)}",
        f"DTEND:{_to_ics_dt(end_iso)}",
        f"SUMMARY:{_escape(title)}",
        f"SEQUENCE:{sequence}",
    ]
    if status:
        lines.append(f"STATUS:{status}")
    if recurring_rrule:
        lines.append(f"RRULE:{recurring_rrule}")
    if attendees_json:
        try:
            for addr in json.loads(attendees_json):
                lines.append(f"ATTENDEE:mailto:{addr}")
        except (ValueError, TypeError):
            pass
    lines.append("END:VEVENT")
    return "\n".join(lines)


def render_calendar_as_ics(
    initial_events: Iterable[InitialCalendarEvent],
    ops: Iterable[CalendarOp],
    *,
    as_of_iso: str,
) -> str:
    """Fold initial events + ops with ts_iso ≤ as_of into a VCALENDAR string.

    Op semantics (mirrors design/10-storage.md):
      add_event       — registers a new event (payload_json carries title/start/end/attendees)
      move_event      — updates start/end on the matching event_id (SEQUENCE bumped)
      cancel_event    — sets STATUS:CANCELLED
      accept_invite   — no calendar mutation; tracks ATTENDEE PARTSTAT (omitted for simplicity)
      decline_invite  — no calendar mutation; tracks PARTSTAT
      tentative_invite — no calendar mutation; tracks PARTSTAT
      update_event    — generic payload-driven update
    """
    # Build a dict event_id → final state
    state: dict[str, dict] = {}

    for ev in initial_events:
        state[ev.event_id] = {
            "title": ev.title,
            "start_iso": ev.start_iso,
            "end_iso": ev.end_iso,
            "attendees_json": ev.attendees_json,
            "recurring_rrule": ev.recurring_rrule,
            "status": None,
            "sequence": 0,
        }

    applicable_ops = [op for op in ops if op.ts_iso <= as_of_iso]
    applicable_ops.sort(key=lambda o: o.ts_iso)

    for op in applicable_ops:
        try:
            payload = json.loads(op.payload_json) if op.payload_json else {}
        except (ValueError, TypeError):
            payload = {}

        if op.op == "add_event":
            state[op.event_id] = {
                "title": payload.get("title", op.event_id),
                "start_iso": payload.get("start_iso", ""),
                "end_iso": payload.get("end_iso", ""),
                "attendees_json": json.dumps(payload["attendees"]) if "attendees" in payload else None,
                "recurring_rrule": payload.get("recurring_rrule"),
                "status": None,
                "sequence": 0,
            }
        elif op.op == "move_event":
            ex = state.get(op.event_id)
            if ex is None:
                continue
            ex["start_iso"] = payload.get("new_start_iso", ex["start_iso"])
            ex["end_iso"] = payload.get("new_end_iso", ex["end_iso"])
            ex["sequence"] += 1
        elif op.op == "cancel_event":
            ex = state.get(op.event_id)
            if ex is None:
                continue
            ex["status"] = "CANCELLED"
            ex["sequence"] += 1
        elif op.op == "update_event":
            ex = state.get(op.event_id)
            if ex is None:
                continue
            for k in ("title", "start_iso", "end_iso", "recurring_rrule"):
                if k in payload:
                    ex[k] = payload[k]
            if "attendees" in payload:
                ex["attendees_json"] = json.dumps(payload["attendees"])
            ex["sequence"] += 1
        # accept_invite / decline_invite / tentative_invite — no event mutation for now

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//myrico//service-emulator//EN",
        "CALSCALE:GREGORIAN",
    ]
    for event_id, ev in sorted(state.items()):
        lines.append(_vevent(
            uid=event_id,
            title=ev["title"],
            start_iso=ev["start_iso"],
            end_iso=ev["end_iso"],
            attendees_json=ev["attendees_json"],
            recurring_rrule=ev["recurring_rrule"],
            status=ev["status"],
            sequence=ev["sequence"],
        ))
    lines.append("END:VCALENDAR")
    return "\n".join(lines)


def _to_ics_dt(iso: str) -> str:
    """Convert ISO 8601 with TZ to iCalendar UTC form (basic '20260424T074200Z')."""
    try:
        dt = datetime.fromisoformat(iso)
        # iCalendar uses YYYYMMDDTHHMMSSZ (UTC). Convert via astimezone then strip.
        from datetime import timezone as _tz
        dt_utc = dt.astimezone(_tz.utc)
        return dt_utc.strftime("%Y%m%dT%H%M%SZ")
    except (ValueError, TypeError):
        return iso


def _escape(s: str) -> str:
    """Escape characters per RFC 5545 §3.3.11."""
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")
