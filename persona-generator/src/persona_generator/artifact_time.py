"""Deterministic per-kind synthetic-timestamp backfill for planned_artifacts.

Stage 5's per-storyline sub-agents may declare a `planned_artifact` without
pinning `target_render_iso` (the field is optional). Before Stage 6 reads
those rows or Stage 7 renders them, ``backfill_planned_artifact_times`` walks
the table and fills any null `target_render_iso` with a deterministic
plausible minute derived from `artifact_id` + `kind` + `target_render_date`.

The function is idempotent: rows that already have `target_render_iso` are
left untouched. Same `artifact_id` always produces the same timestamp.

Per-kind plausible windows (Pacific time, TZ offset -07:00 in this window):

  email           — 06:00–22:00  (covers morning catch-up, workday, late evening replies)
  note            — 05:00–23:00  (kitchen-table txt-file edits, board prep at 9 PM, etc.)
  calendar_invite — 08:00–18:00  (sent during business hours)
  calendar_update — 08:00–18:00  (same)

Within the kind's window, the minute is chosen by SHA-256 hash of artifact_id
modulo the window size. This is deterministic — re-running backfill on the
same data produces the same timestamps.
"""

from __future__ import annotations

import hashlib
from typing import Tuple

from sqlmodel import Session, select

from .db import engine_for
from .models import PlannedArtifact

# Per-kind (start_minute, end_minute) windows. Minute 0 = midnight.
_WINDOWS_BY_KIND: dict[str, Tuple[int, int]] = {
    "email": (6 * 60, 22 * 60),
    "note": (5 * 60, 23 * 60),
    "calendar_invite": (8 * 60, 18 * 60),
    "calendar_update": (8 * 60, 18 * 60),
}

# Hard-coded Pacific Time offset for the eval window (2026-04-19..2026-05-23
# all sit within Pacific Daylight Time, UTC-07:00).
_PT_OFFSET = "-07:00"


def _minute_for(artifact_id: str, kind: str) -> int:
    """Pick a deterministic minute-of-day inside the kind's window."""
    start, end = _WINDOWS_BY_KIND.get(kind, (8 * 60, 18 * 60))
    span = end - start
    if span <= 0:
        return start
    h = int(hashlib.sha256(artifact_id.encode()).hexdigest()[:8], 16)
    return start + (h % span)


def synthesize_target_render_iso(
    artifact_id: str, kind: str, target_render_date: str
) -> str:
    """Return a deterministic 'YYYY-MM-DDTHH:MM:00-07:00' for this artifact."""
    minute = _minute_for(artifact_id, kind)
    hh, mm = divmod(minute, 60)
    return f"{target_render_date}T{hh:02d}:{mm:02d}:00{_PT_OFFSET}"


def backfill_planned_artifact_times(slug: str) -> int:
    """Fill `target_render_iso` for any planned_artifact rows missing it.

    Returns the count of rows backfilled. Idempotent — re-running with no
    nulls in the table is a cheap no-op.
    """
    backfilled = 0
    with Session(engine_for(slug)) as session:
        rows = session.exec(
            select(PlannedArtifact).where(PlannedArtifact.target_render_iso == None)  # noqa: E711
        ).all()
        for row in rows:
            row.target_render_iso = synthesize_target_render_iso(
                row.artifact_id, row.kind, row.target_render_date
            )
            session.add(row)
            backfilled += 1
        if backfilled:
            session.commit()
    return backfilled


def reconcile_planned_artifact_times_from_rendered(slug: str) -> dict[str, int]:
    """Post-render reconciliation: pull timestamps from the actually-rendered
    tables back into ``planned_artifacts.target_render_iso``.

    Used after a pipeline run where Stage 5 didn't pin times (target_render_iso
    is NULL) and Stage 7 picked its own minutes when rendering. After this
    runs, planned_artifacts.target_render_iso matches the corresponding
    emails.date_iso / notes.created_iso / calendar_ops.ts_iso for every
    artifact, so the digest agent sees a consistent view.

    Lookup priority per kind:
      email           → ``emails.date_iso``           WHERE emails.artifact_id = pa.artifact_id
      note            → ``notes.created_iso``         WHERE notes.artifact_id = pa.artifact_id
      calendar_invite → ``calendar_ops.ts_iso``       WHERE the op references this artifact_id in its payload
      calendar_update → same as calendar_invite

    Rows that can't be reconciled (e.g., a planned artifact Stage 7 never
    rendered) fall back to the deterministic hash-based synthesis.

    Returns ``{'reconciled': N, 'fell_back': M}``.
    """
    # Local imports — these models only exist once Stage 7 has populated them.
    from .models import CalendarOp, Email, Note  # noqa: WPS433

    reconciled = 0
    fell_back = 0

    with Session(engine_for(slug)) as session:
        # Build artifact_id → ISO timestamp maps from the rendered tables.
        email_map = {
            e.artifact_id: e.date_iso
            for e in session.exec(select(Email).where(Email.artifact_id != None)).all()  # noqa: E711
            if e.artifact_id
        }
        note_map = {
            n.artifact_id: n.created_iso
            for n in session.exec(select(Note).where(Note.artifact_id != None)).all()  # noqa: E711
            if n.artifact_id
        }
        # Calendar ops: payload_json may reference artifact_id via the tool's
        # optional ``artifact_id`` arg. The CalendarOp model doesn't persist it
        # as its own column, so we string-search payload_json. This is a
        # best-effort linkage for calendar artifacts.
        cal_ops = list(session.exec(select(CalendarOp)).all())

        def cal_iso_for(artifact_id: str) -> str | None:
            for op in cal_ops:
                if op.payload_json and artifact_id in op.payload_json:
                    return op.ts_iso
            return None

        # Walk every planned artifact and assign target_render_iso.
        pas = list(session.exec(select(PlannedArtifact)).all())
        for pa in pas:
            hit: str | None = None
            if pa.kind == "email":
                hit = email_map.get(pa.artifact_id)
            elif pa.kind == "note":
                hit = note_map.get(pa.artifact_id)
            elif pa.kind in ("calendar_invite", "calendar_update"):
                hit = cal_iso_for(pa.artifact_id)

            if hit is None:
                hit = synthesize_target_render_iso(
                    pa.artifact_id, pa.kind, pa.target_render_date
                )
                fell_back += 1
            else:
                reconciled += 1

            pa.target_render_iso = hit
            session.add(pa)

        session.commit()

    return {"reconciled": reconciled, "fell_back": fell_back}
