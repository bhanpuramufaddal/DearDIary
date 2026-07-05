"""Stage 9a structured tools: ``validation_pass`` / ``validation_fail`` / ``validation_correct``.

Each tool INSERTs (UPSERTs) exactly one row into ``validation_log``, keyed on
``moment_id``. The validator agent calls exactly one of these per invocation
and terminates. The combination of (status, justification, reason, severity,
corrected_rationale, corrected_priority) per row is the entire eval signal
that Stage 9b's deterministic walk consumes.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated, Any

from claude_agent_sdk import tool
from sqlmodel import Session

from ..db import engine_for
from ..models import DeclaredMoment, ValidationLog

VALID_STATUSES = {"pass", "fail", "correct"}
VALID_SEVERITIES = {"minor", "major"}


def _ok(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps({"ok": True, **payload})}]}


def _err(msg: str) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps({"ok": False, "error": msg})}],
        "isError": True,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _upsert(slug: str, moment_id: str, **fields: Any) -> None:
    with Session(engine_for(slug)) as session:
        if session.get(DeclaredMoment, moment_id) is None:
            raise ValueError(f"moment_id '{moment_id}' not found in declared_moments")
        existing = session.get(ValidationLog, moment_id)
        if existing is None:
            session.add(
                ValidationLog(
                    moment_id=moment_id,
                    status=fields["status"],
                    justification=fields["justification"],
                    reason=fields.get("reason"),
                    severity=fields.get("severity"),
                    corrected_rationale=fields.get("corrected_rationale"),
                    corrected_priority=fields.get("corrected_priority"),
                    validated_at=_now(),
                )
            )
        else:
            existing.status = fields["status"]
            existing.justification = fields["justification"]
            existing.reason = fields.get("reason")
            existing.severity = fields.get("severity")
            existing.corrected_rationale = fields.get("corrected_rationale")
            existing.corrected_priority = fields.get("corrected_priority")
            existing.validated_at = _now()
            session.add(existing)
        session.commit()


def build_validation_pass(*, slug: str):
    @tool(
        "validation_pass",
        "Record that this declared moment is internally consistent given the persona's "
        "complete past as of end-of-day (target_morning - 1). Justification names the "
        "specific evidence (message_id, daily_state file, calendar event) that makes the "
        "moment cohere.",
        {
            "moment_id": Annotated[str, "The declared_moments.moment_id under review."],
            "justification": Annotated[str, "1–2 sentences naming specific evidence (file paths, message_ids, dates)."],
        },
    )
    async def validation_pass(args: dict[str, Any]) -> dict[str, Any]:
        try:
            _upsert(slug, args["moment_id"], status="pass", justification=args["justification"])
        except ValueError as exc:
            return _err(str(exc))
        return _ok({"moment_id": args["moment_id"], "status": "pass"})

    return validation_pass


def build_validation_fail(*, slug: str):
    @tool(
        "validation_fail",
        "Record that this declared moment is NOT internally consistent. Reason names the "
        "specific defect (obsolete: action already happened on day X; contradicted by "
        "moment Y; rationale references events that didn't happen; persona-fit per "
        "judgment.md lines N–M). Severity is 'major' if surfacing would mislead the "
        "persona, 'minor' if it's a small currency lapse.",
        {
            "moment_id": Annotated[str, "The declared_moments.moment_id under review."],
            "reason": Annotated[str, "Specific defect; names artifact ids, dates, file paths."],
            "severity": Annotated[str, "'minor' | 'major'."],
        },
    )
    async def validation_fail(args: dict[str, Any]) -> dict[str, Any]:
        if args["severity"] not in VALID_SEVERITIES:
            return _err(f"severity must be one of {sorted(VALID_SEVERITIES)}, got '{args['severity']}'")
        try:
            _upsert(
                slug,
                args["moment_id"],
                status="fail",
                justification=args["reason"],
                reason=args["reason"],
                severity=args["severity"],
            )
        except ValueError as exc:
            return _err(str(exc))
        return _ok({"moment_id": args["moment_id"], "status": "fail", "severity": args["severity"]})

    return validation_fail


def build_validation_correct(*, slug: str):
    @tool(
        "validation_correct",
        "Record that the moment basically holds but needs a SMALL surgical fix (a wrong "
        "deadline date, a slightly-off priority, a name typo). If the fix requires "
        "rewriting more than one sentence of the rationale, FAIL instead of CORRECT.",
        {
            "moment_id": Annotated[str, "The declared_moments.moment_id under review."],
            "corrected_rationale": Annotated[str, "The fixed rationale (replaces the original at digest time)."],
            "corrected_priority": Annotated[str | None, "The fixed priority ('P0'|'P1'|'P2') if priority is what's wrong; null if rationale-only fix."],
            "justification": Annotated[str, "1–2 sentences naming what was wrong and why this surgical fix is appropriate."],
        },
    )
    async def validation_correct(args: dict[str, Any]) -> dict[str, Any]:
        cp = args.get("corrected_priority")
        if cp is not None and cp not in {"P0", "P1", "P2"}:
            return _err(f"corrected_priority must be P0|P1|P2 or null, got '{cp}'")
        try:
            _upsert(
                slug,
                args["moment_id"],
                status="correct",
                justification=args["justification"],
                corrected_rationale=args["corrected_rationale"],
                corrected_priority=cp,
            )
        except ValueError as exc:
            return _err(str(exc))
        return _ok({"moment_id": args["moment_id"], "status": "correct"})

    return validation_correct
