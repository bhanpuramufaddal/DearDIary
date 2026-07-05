"""Notes-service REST routes.

  GET  /notes              — list notes visible at as_of
  GET  /notes/{note_id}    — full note as markdown
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from sqlmodel import Session, select

from persona_generator.db import engine_for
from persona_generator.models import Note

from ..clock import parse_as_of
from ..rendering.notes import render_note_as_markdown

router = APIRouter()


@router.get("")
def list_notes(
    request: Request,
    as_of: Optional[str] = None,
    storyline: Optional[str] = None,
    limit: int = 100,
):
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)
    with Session(engine_for(slug)) as session:
        q = select(Note).where(Note.created_iso <= as_of_iso)
        if storyline:
            q = q.where(Note.x_synth_storyline == storyline)
        rows = list(session.exec(q.order_by(Note.created_iso.desc()).limit(limit)).all())
    return {
        "as_of": as_of_iso,
        "count": len(rows),
        "notes": [_summarize(n) for n in rows],
    }


@router.get("/{note_id}")
def get_note(note_id: str, request: Request, as_of: Optional[str] = None, format: str = "markdown"):
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)
    with Session(engine_for(slug)) as session:
        note = session.get(Note, note_id)
        if note is None or note.created_iso > as_of_iso:
            raise HTTPException(status_code=404, detail=f"note_id '{note_id}' not visible at as_of={as_of_iso}")
    if format == "json":
        return _summarize(note) | {"body": note.body}
    return Response(content=render_note_as_markdown(note), media_type="text/markdown")


def _summarize(n: Note) -> dict:
    return {
        "note_id": n.note_id,
        "filename": n.filename,
        "title": n.title,
        "created_iso": n.created_iso,
        "updated_iso": n.updated_iso,
        "storyline_id": n.x_synth_storyline,
        "moment_id": n.x_synth_moment_id,
        "tonal_zone": n.x_synth_tonal_zone,
        "artifact_id": n.artifact_id,
    }
