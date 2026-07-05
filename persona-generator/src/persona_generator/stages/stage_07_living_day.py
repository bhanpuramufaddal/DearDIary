"""Stage 7 — Living the 35 Days (rendering only).

35 sequential day-agent runs. Each day:
  - Reads pre-declared events for today from DB (planned_artifacts, noise_events).
  - Reads yesterday's daily_state/day_(N-1).md.
  - Renders each planned_artifact via emit_email / write_note.
  - Records calendar changes via add_calendar_op.
  - Appends to activity_log.md and writes daily_state/day_NN.md.

Uses Haiku 4.5 (rendering, not authoring). The plot is already authored at
Stage 5; this stage just emits.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from ..agent_runtime import HAIKU_MODEL, RunResult, run_agent, verify_file_exists
from ..artifact_time import backfill_planned_artifact_times
from ..db import engine_for, persona_dir
from ..models import (
    CalendarOp,
    DeclaredMoment,
    Email,
    Note,
    NoiseEvent,
    PlannedArtifact,
    Storyline,
)
from ..tools.artifact_emit import build_add_calendar_op, build_emit_email, build_write_note
from ..tools.email_attachment import build_emit_email_attachment
from ._common import default_render_vars, ensure_persona_spec_visible, load_stage_prompt, render

STAGE_ID = "stage_07_living_day"
WINDOW_START = date(2026, 4, 19)
WINDOW_END = date(2026, 5, 23)
WINDOW_DAYS = 35

REQUIRED_DAILY_STATE_TAGS = (
    "<open_threads>",
    "<calendar_state>",
    "<persona_state>",
    "<storyline_pointers>",
)


def _iso(d: date) -> str:
    return d.isoformat()


def _weekday(d: date) -> str:
    return d.strftime("%A")


def _padded(day_num: int) -> str:
    return f"{day_num:02d}"


def _day_n_to_date(day_num: int) -> date:
    return WINDOW_START + timedelta(days=day_num - 1)


def _planned_artifacts_block(slug: str, target_date: str) -> str:
    with Session(engine_for(slug)) as session:
        rows = session.exec(
            select(PlannedArtifact).where(PlannedArtifact.target_render_date == target_date)
        ).all()
    if not rows:
        return "(none — quiet day; you may still write the day's activity_log + daily_state.)"
    lines = []
    for r in rows:
        sketch = (r.content_sketch or "").replace("\n", " ").strip()
        decoy = " [DECOY — render as background noise; persona will not act on it]" if r.is_decoy else ""
        # target_render_iso is the synthetic timestamp the digest agent will treat
        # as the artifact's real arrival/creation time. The day-agent MUST use it
        # exactly when calling emit_email/write_note/add_calendar_op — do not
        # invent a different minute.
        iso = r.target_render_iso or f"{target_date}T12:00:00-07:00"
        lines.append(
            f"- artifact_id={r.artifact_id} | kind={r.kind} | storyline={r.storyline_id} | "
            f"target_render_iso={iso}{decoy}\n"
            f"    sketch: {sketch[:280]}"
        )
    return "\n".join(lines)


def _noise_events_block(slug: str, target_date: str) -> str:
    with Session(engine_for(slug)) as session:
        rows = session.exec(
            select(NoiseEvent).where(NoiseEvent.occurrence_date == target_date)
        ).all()
    if not rows:
        return "(none today.)"
    lines = []
    for r in rows:
        trigger = f" triggers artifact={r.triggers_artifact_id}" if r.triggers_artifact_id else ""
        lines.append(f"- noise_id={r.noise_id} | storyline={r.storyline_id}{trigger}")
    return "\n".join(lines)


def _calendar_ops_summary(slug: str, before_date: str, n_recent: int = 8) -> str:
    with Session(engine_for(slug)) as session:
        rows = session.exec(
            select(CalendarOp)
            .where(CalendarOp.ts_iso < before_date + "T23:59:59")
            .order_by(CalendarOp.ts_iso.desc())  # type: ignore
            .limit(n_recent)
        ).all()
    if not rows:
        return "(no calendar churn yet — this is early window.)"
    lines = []
    for r in reversed(rows):  # oldest-first for readability
        lines.append(f"- {r.ts_iso} | {r.op} | event={r.event_id} | source={r.source}")
    return "\n".join(lines)


def _active_storylines_block(slug: str, prior_day_state_path: str) -> str:
    """Pull the prior day's <storyline_pointers> section if present; else list all storylines."""
    p = persona_dir(slug) / prior_day_state_path
    if p.exists():
        body = p.read_text(encoding="utf-8")
        start = body.find("<storyline_pointers>")
        end = body.find("</storyline_pointers>")
        if start != -1 and end != -1:
            return body[start + len("<storyline_pointers>") : end].strip()
    with Session(engine_for(slug)) as session:
        rows = session.exec(select(Storyline)).all()
    return "\n".join(f"- {r.storyline_id}: {r.display_name}" for r in rows)


def _archetype_hint(target_date: date) -> str:
    """A one-line hint about today's archetype based on weekday + position in window."""
    weekday = target_date.strftime("%A")
    if weekday in ("Saturday", "Sunday"):
        return f"{weekday} — weekend; mostly family/personal; no work meetings unless storyline requires."
    if target_date == WINDOW_START:
        return "Sunday — Day 1 of window; warm-up; light/preparatory day."
    return f"{weekday} — workday; standing meetings + storyline-driven activity."


def _day_user_prompt(*, slug: str, day_num: int) -> str:
    d = _day_n_to_date(day_num)
    iso_date = _iso(d)
    weekday = _weekday(d)
    padded = _padded(day_num)
    prior_padded = _padded(day_num - 1) if day_num > 1 else "00"
    prior_filename = f"day_{prior_padded}.md" if day_num > 1 else "(Day 1; no prior state — start from foundation docs)"

    planned_block = _planned_artifacts_block(slug, iso_date)
    noise_block = _noise_events_block(slug, iso_date)
    cal_summary = _calendar_ops_summary(slug, iso_date)
    storylines_block = _active_storylines_block(slug, f"internal/daily_state/day_{prior_padded}.md")
    archetype = _archetype_hint(d)

    return f"""Today is Day {day_num} of 35 — {iso_date} ({weekday}).

Prior day state file: internal/daily_state/{prior_filename}
(Read this first. It tells you what is unresolved coming into today. For Day 1 this file does not exist and you start from the foundation documents.)

Today's pre-declared planned artifacts (from Stage 5; render each one via emit_email or write_note):

{planned_block}

Today's pre-declared noise events (from Stage 5; let these shape what happens, including the contradiction cases — email-without-op moves, etc.):

{noise_block}

Cumulative calendar churn so far (for context, so today's moves read as the Nth, not the first):

{cal_summary}

Active storylines as of today (so you know which arcs to keep moving):

{storylines_block}

Today's archetype hint:

{archetype}

Produce, in order:
  1. emit_email / write_note calls for every planned artifact above
  2. add_calendar_op calls for every calendar change today (omitting the contradiction cases by design)
  3. Edit/Write to append "## Day {day_num} — {iso_date}" to activity_log.md with a 2–4 paragraph prose body
  4. Write internal/daily_state/day_{padded}.md with the four XML-tagged sections in prose

Then stop.
"""


def _day_verifier(*, slug: str, day_num: int) -> "tuple[bool, list[str]]":
    iso_date = _iso(_day_n_to_date(day_num))
    padded = _padded(day_num)
    missing: list[str] = []

    # daily_state file exists with all four tags
    state_path = f"internal/daily_state/day_{padded}.md"
    ok_file, miss = verify_file_exists(slug, state_path)
    if not ok_file:
        missing.extend(miss)
    else:
        body = (persona_dir(slug) / state_path).read_text(encoding="utf-8")
        for tag in REQUIRED_DAILY_STATE_TAGS:
            if tag not in body:
                missing.append(f"{state_path} missing tag {tag}")
        if len(body) < 600:
            missing.append(f"{state_path} too short ({len(body)} chars; want ≥ 600)")

    # activity_log.md contains today's heading
    log_path = persona_dir(slug) / "activity_log.md"
    if not log_path.exists():
        missing.append("activity_log.md does not exist")
    else:
        log_body = log_path.read_text(encoding="utf-8")
        heading = f"## Day {day_num} — {iso_date}"
        if heading not in log_body:
            missing.append(f"activity_log.md missing heading '{heading}'")

    # Every planned_artifact for today has been emitted (email or note OR was a calendar artifact)
    with Session(engine_for(slug)) as session:
        planned = session.exec(
            select(PlannedArtifact).where(PlannedArtifact.target_render_date == iso_date)
        ).all()
        emitted_email_ids = {
            r.artifact_id
            for r in session.exec(select(Email).where(Email.artifact_id != None)).all()  # noqa: E711
            if r.artifact_id
        }
        emitted_note_ids = {
            r.artifact_id
            for r in session.exec(select(Note).where(Note.artifact_id != None)).all()  # noqa: E711
            if r.artifact_id
        }
        for p in planned:
            if p.kind in ("calendar_invite", "calendar_update"):
                # Calendar artifacts are rendered via add_calendar_op; no email/note row expected.
                continue
            if p.kind == "email" and p.artifact_id not in emitted_email_ids:
                missing.append(f"planned_artifact {p.artifact_id} (email) not emitted")
            if p.kind == "note" and p.artifact_id not in emitted_note_ids:
                missing.append(f"planned_artifact {p.artifact_id} (note) not emitted")

    return (not missing, missing)


def _day_already_complete(slug: str, day_num: int) -> bool:
    ok, _ = _day_verifier(slug=slug, day_num=day_num)
    return ok


def run_stage_07(*, slug: str, day_range: tuple[int, int] | None = None) -> dict[str, Any]:
    """Run the 35-day rendering loop sequentially.

    ``day_range`` is (lo, hi) inclusive; default (1, 35). Useful for resume.
    """
    ensure_persona_spec_visible(slug)
    (persona_dir(slug) / "internal" / "daily_state").mkdir(parents=True, exist_ok=True)

    # Backfill any planned_artifacts missing target_render_iso (Stage 5 may have
    # left them null if its sub-agents didn't pin a precise minute). This runs
    # before any day-agent reads planned_artifacts so the rendered email/note/
    # calendar_op timestamps come from the pinned synthetic clock.
    backfill_planned_artifact_times(slug)

    system_prompt, _ = load_stage_prompt(STAGE_ID)
    vars_ = default_render_vars(slug)
    system_prompt = render(system_prompt, **vars_)

    lo, hi = day_range or (1, WINDOW_DAYS)
    errors: list[dict[str, Any]] = []
    completed_days: list[int] = []

    tools = (
        build_emit_email(slug=slug),
        build_emit_email_attachment(slug=slug),
        build_write_note(slug=slug),
        build_add_calendar_op(slug=slug),
    )

    for day_num in range(lo, hi + 1):
        if _day_already_complete(slug, day_num):
            completed_days.append(day_num)
            continue

        user_prompt = _day_user_prompt(slug=slug, day_num=day_num)

        def _verifier_for_this_day(s: str, _d=day_num) -> tuple[bool, list[str]]:
            return _day_verifier(slug=s, day_num=_d)

        result: RunResult = run_agent(
            stage_id=f"{STAGE_ID}_day_{_padded(day_num)}",
            slug=slug,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            structured_tools=tools,
            allowed_file_tools=("Read", "Write", "Edit", "Glob"),
            verifier=_verifier_for_this_day,
            model=HAIKU_MODEL,
        )
        if not result.success:
            errors.append(
                {
                    "stage": f"{STAGE_ID}_day_{_padded(day_num)}",
                    "message": result.error
                    or "missing outputs: " + ", ".join(result.missing_outputs),
                    "retry_count": 0,
                }
            )
            # Don't abort the whole 35-day run on one bad day — log and continue.
            continue
        completed_days.append(day_num)

    return {
        "completed_stages": [STAGE_ID] if not errors else [],
        "errors": errors,
        "stage_outputs": {STAGE_ID: [f"days_completed: {len(completed_days)}/{hi - lo + 1}"]},
    }
