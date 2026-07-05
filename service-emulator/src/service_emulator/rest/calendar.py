"""Calendar-service REST routes.

  GET  /calendar/events            — JSON list of events as of as_of
  GET  /calendar/events/{event_id} — single event JSON
  GET  /calendar/ics               — full iCalendar .ics dump as of as_of
  GET  /calendar/ops               — raw op log (for debugging)
"""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from sqlmodel import Session, select

from persona_generator.db import engine_for
from persona_generator.models import CalendarOp, InitialCalendarEvent

from ..clock import parse_as_of
from ..rendering.ics import render_calendar_as_ics

router = APIRouter()


def _replay_state(slug: str, as_of_iso: str) -> dict[str, dict]:
    """Walk initial_calendar_events + calendar_ops to compute current state."""
    with Session(engine_for(slug)) as session:
        initial = list(session.exec(select(InitialCalendarEvent)).all())
        ops = list(
            session.exec(
                select(CalendarOp)
                .where(CalendarOp.ts_iso <= as_of_iso)
                .order_by(CalendarOp.ts_iso)
            ).all()
        )

    state: dict[str, dict] = {}
    for ev in initial:
        state[ev.event_id] = {
            "event_id": ev.event_id,
            "title": ev.title,
            "start_iso": ev.start_iso,
            "end_iso": ev.end_iso,
            "attendees": _parse_attendees(ev.attendees_json),
            "recurring_rrule": ev.recurring_rrule,
            "status": "CONFIRMED",
            "source": "initial",
            "sequence": 0,
        }

    for op in ops:
        try:
            payload = json.loads(op.payload_json) if op.payload_json else {}
        except (ValueError, TypeError):
            payload = {}
        if op.op == "add_event":
            state[op.event_id] = {
                "event_id": op.event_id,
                "title": payload.get("title", op.event_id),
                "start_iso": payload.get("start_iso", ""),
                "end_iso": payload.get("end_iso", ""),
                "attendees": payload.get("attendees", []),
                "recurring_rrule": payload.get("recurring_rrule"),
                "status": "CONFIRMED",
                "source": "op",
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
                ex["attendees"] = payload["attendees"]
            ex["sequence"] += 1
    return state


@router.get("/events")
def list_events(request: Request, as_of: Optional[str] = None, include_cancelled: bool = False):
    """List events visible at as_of. Default excludes cancelled."""
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)
    state = _replay_state(slug, as_of_iso)
    events = [ev for ev in state.values() if include_cancelled or ev["status"] != "CANCELLED"]
    events.sort(key=lambda e: e["start_iso"])
    return {"as_of": as_of_iso, "count": len(events), "events": events}


@router.get("/events/{event_id}")
def get_event(event_id: str, request: Request, as_of: Optional[str] = None):
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)
    state = _replay_state(slug, as_of_iso)
    ev = state.get(event_id)
    if ev is None:
        raise HTTPException(status_code=404, detail=f"event_id '{event_id}' not visible at as_of={as_of_iso}")
    return ev


@router.get("/ics")
def get_ics(request: Request, as_of: Optional[str] = None):
    """Full iCalendar dump as of as_of."""
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)
    with Session(engine_for(slug)) as session:
        initial = list(session.exec(select(InitialCalendarEvent)).all())
        ops = list(session.exec(select(CalendarOp)).all())
    ics = render_calendar_as_ics(initial, ops, as_of_iso=as_of_iso)
    return Response(content=ics, media_type="text/calendar")


@router.get("/ops")
def list_ops(request: Request, as_of: Optional[str] = None, limit: int = 200):
    """Raw op log for debugging — gives the full transition history."""
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)
    with Session(engine_for(slug)) as session:
        ops = list(
            session.exec(
                select(CalendarOp)
                .where(CalendarOp.ts_iso <= as_of_iso)
                .order_by(CalendarOp.ts_iso)
                .limit(limit)
            ).all()
        )
    return {
        "as_of": as_of_iso,
        "count": len(ops),
        "ops": [
            {
                "op_id": o.op_id,
                "ts_iso": o.ts_iso,
                "op": o.op,
                "event_id": o.event_id,
                "source": o.source,
                "linked_message_id": o.linked_message_id,
                "payload": json.loads(o.payload_json) if o.payload_json else {},
            }
            for o in ops
        ],
    }


def _parse_attendees(s: str | None) -> list:
    if not s:
        return []
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return []
