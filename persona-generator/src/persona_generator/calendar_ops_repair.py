"""Backfill helper: canonicalize key names in ``calendar_ops.payload_json``.

Stage 7's day-agent variably uses short keys (``start`` / ``end``) instead of
the canonical ``start_iso`` / ``end_iso`` documented on the tool, and similarly
for move_events (``start``/``end`` instead of ``new_start_iso``/``new_end_iso``).
The downstream calendar replay (and the service emulator) expects the canonical
keys; this helper rewrites existing rows in-place so a resume picks up clean
data without re-emitting.

Idempotent: re-running on an already-canonical row leaves it untouched.
"""

from __future__ import annotations

import json
from typing import Optional

from sqlmodel import Session, select

from .db import engine_for
from .models import CalendarOp


def _canonicalize_add_event(payload: dict) -> dict:
    """add_event: rename start → start_iso, end → end_iso. Preserve everything else."""
    if "start_iso" not in payload and "start" in payload:
        payload["start_iso"] = payload.pop("start")
    if "end_iso" not in payload and "end" in payload:
        payload["end_iso"] = payload.pop("end")
    return payload


def _canonicalize_move_event(payload: dict) -> dict:
    """move_event: rename start → new_start_iso, end → new_end_iso, start_iso → new_start_iso, end_iso → new_end_iso."""
    if "new_start_iso" not in payload:
        if "start_iso" in payload:
            payload["new_start_iso"] = payload.pop("start_iso")
        elif "start" in payload:
            payload["new_start_iso"] = payload.pop("start")
    if "new_end_iso" not in payload:
        if "end_iso" in payload:
            payload["new_end_iso"] = payload.pop("end_iso")
        elif "end" in payload:
            payload["new_end_iso"] = payload.pop("end")
    return payload


def repair_calendar_op_payloads(slug: str) -> dict[str, int]:
    """Rewrite payload_json on every calendar_op row to canonical key names.

    Returns ``{'rewritten': N, 'unchanged': M}``.
    """
    rewritten = 0
    unchanged = 0
    with Session(engine_for(slug)) as session:
        ops = list(session.exec(select(CalendarOp)).all())
        for op in ops:
            try:
                payload = json.loads(op.payload_json) if op.payload_json else {}
            except (ValueError, TypeError):
                unchanged += 1
                continue
            before = dict(payload)
            if op.op == "add_event":
                payload = _canonicalize_add_event(payload)
            elif op.op == "move_event":
                payload = _canonicalize_move_event(payload)
            if payload != before:
                op.payload_json = json.dumps(payload)
                session.add(op)
                rewritten += 1
            else:
                unchanged += 1
        if rewritten:
            session.commit()
    return {"rewritten": rewritten, "unchanged": unchanged}
