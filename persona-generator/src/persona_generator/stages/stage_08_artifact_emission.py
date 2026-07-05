"""Stage 8 — Artifact Emission (safety net).

After Stage 7 finishes, this stage queries for any planned_artifact rows that
do NOT yet have a corresponding emails/notes row, and emits them one at a time.
This catches gaps from partial Stage 7 retries.

For each gap:
  - Build a small per-artifact prompt (artifact_id, kind, target_date, storyline,
    content_sketch).
  - Run a Haiku agent with the appropriate emit tool.
  - Verifier checks the row now exists.

calendar_invite / calendar_update artifacts are intentionally not gap-filled
here — they go through ``add_calendar_op`` which has no required artifact_id
linkage and is more of a free-form log.
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from ..agent_runtime import HAIKU_MODEL, RunResult, run_agent
from ..db import engine_for, persona_dir
from ..models import Email, Note, PlannedArtifact, Storyline
from ..tools.artifact_emit import build_emit_email, build_write_note
from ._common import default_render_vars, ensure_persona_spec_visible, load_stage_prompt, render

STAGE_ID = "stage_08_artifact_emission"
WINDOW_START = date(2026, 4, 19)


def _day_num_from_iso(iso_date: str) -> int:
    return (date.fromisoformat(iso_date) - WINDOW_START).days + 1


def _arc_excerpt(slug: str, storyline_id: str, *, max_chars: int = 1200) -> str:
    """Pull a short excerpt of the storyline arc.md to help the agent ground tone."""
    with Session(engine_for(slug)) as session:
        s = session.get(Storyline, storyline_id)
    if s is None:
        return ""
    arc_path = persona_dir(slug) / s.arc_path
    if not arc_path.exists():
        return ""
    body = arc_path.read_text(encoding="utf-8")
    return body[:max_chars]


def _missing_artifacts(slug: str) -> list[PlannedArtifact]:
    """Find planned_artifacts of kind email|note that have no matching emails/notes row."""
    with Session(engine_for(slug)) as session:
        planned = session.exec(
            select(PlannedArtifact).where(PlannedArtifact.kind.in_(("email", "note")))  # type: ignore
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
    missing: list[PlannedArtifact] = []
    for p in planned:
        if p.kind == "email" and p.artifact_id not in emitted_email_ids:
            missing.append(p)
        elif p.kind == "note" and p.artifact_id not in emitted_note_ids:
            missing.append(p)
    return missing


def _verifier_for_artifact(artifact: PlannedArtifact):
    def _v(slug: str) -> tuple[bool, list[str]]:
        with Session(engine_for(slug)) as session:
            if artifact.kind == "email":
                hit = session.exec(
                    select(Email).where(Email.artifact_id == artifact.artifact_id)
                ).first()
            else:
                hit = session.exec(
                    select(Note).where(Note.artifact_id == artifact.artifact_id)
                ).first()
        if hit is None:
            return False, [f"artifact {artifact.artifact_id} still not emitted"]
        return True, []

    return _v


def _per_artifact_user_prompt(slug: str, artifact: PlannedArtifact) -> str:
    day_num = _day_num_from_iso(artifact.target_render_date)
    weekday = date.fromisoformat(artifact.target_render_date).strftime("%A")
    decoy = "TRUE — render as background noise; persona will not act on it" if artifact.is_decoy else "FALSE"
    arc = _arc_excerpt(slug, artifact.storyline_id)
    arc_block = f"\nArc context (excerpt from `{artifact.storyline_id}/arc.md`):\n\n{arc}\n" if arc else ""

    return f"""Render artifact `{artifact.artifact_id}` for `{slug}`.

- Artifact kind: **{artifact.kind}**
- Storyline: **{artifact.storyline_id}**
- Target render date: **{artifact.target_render_date}** (Day {day_num} of 35, {weekday})
- Decoy: {decoy}

Content sketch (from Stage 5):

{artifact.content_sketch or "(none — infer from arc context)"}
{arc_block}
You also have these documents on disk if you need them (use paginated `Read`):
- `internal/character_sketch.md` — persona's voice and register
- `internal/cast.md` — relationship context for the named correspondent
- `internal/daily_state/day_{day_num:02d}.md` — day-of context (if Stage 7 ran for this day)

Call exactly ONE of `emit_email` or `write_note` (matching the artifact kind),
with the rendered body in the persona's voice. The `artifact_id` parameter
MUST be `{artifact.artifact_id}`. Pull the tonal zone from the arc context and
cast relationship; pull `x_synth_storyline` = `{artifact.storyline_id}`; set
`x_synth_decoy` = {str(bool(artifact.is_decoy))}. Then stop.
"""


def run_stage_08(*, slug: str) -> dict[str, Any]:
    ensure_persona_spec_visible(slug)
    missing = _missing_artifacts(slug)
    if not missing:
        return {
            "completed_stages": [STAGE_ID],
            "stage_outputs": {STAGE_ID: ["no_gaps: Stage 7 emitted everything"]},
        }

    system_prompt, _ = load_stage_prompt(STAGE_ID)
    vars_ = default_render_vars(slug)
    system_prompt = render(system_prompt, **vars_)

    tools = (build_emit_email(slug=slug), build_write_note(slug=slug))
    errors: list[dict[str, Any]] = []
    filled = 0

    for artifact in missing:
        user_prompt = _per_artifact_user_prompt(slug, artifact)
        verifier = _verifier_for_artifact(artifact)
        result: RunResult = run_agent(
            stage_id=f"{STAGE_ID}__{artifact.artifact_id[:32]}",
            slug=slug,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            structured_tools=tools,
            allowed_file_tools=("Read", "Glob"),
            verifier=verifier,
            model=HAIKU_MODEL,
        )
        if not result.success:
            errors.append(
                {
                    "stage": STAGE_ID,
                    "message": f"{artifact.artifact_id}: {result.error or 'still missing'}",
                    "retry_count": 0,
                }
            )
            continue
        filled += 1

    return {
        "completed_stages": [STAGE_ID] if not errors else [],
        "errors": errors,
        "stage_outputs": {STAGE_ID: [f"filled {filled} gaps of {len(missing)}"]},
    }
