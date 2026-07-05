"""Render a ``Note`` row as a markdown document.

Notes already live as text in the DB. The wire format is just markdown with
optional X-Synth-* front matter so consumers can read the eval metadata.
"""

from __future__ import annotations

from persona_generator.models import Note


def render_note_as_markdown(note: Note, *, include_frontmatter: bool = True) -> str:
    """Return a single markdown document. If ``include_frontmatter`` is set,
    prepend a YAML-style frontmatter block with the X-Synth-* fields."""
    parts: list[str] = []
    if include_frontmatter:
        parts.append("---")
        parts.append(f"note_id: {note.note_id}")
        parts.append(f"filename: {note.filename}")
        if note.title:
            parts.append(f"title: {note.title}")
        parts.append(f"created_iso: {note.created_iso}")
        if note.updated_iso:
            parts.append(f"updated_iso: {note.updated_iso}")
        if note.x_synth_storyline:
            parts.append(f"x_synth_storyline: {note.x_synth_storyline}")
        if note.x_synth_moment_id:
            parts.append(f"x_synth_moment_id: {note.x_synth_moment_id}")
        if note.x_synth_tonal_zone:
            parts.append(f"x_synth_tonal_zone: {note.x_synth_tonal_zone}")
        if note.x_synth_source_plan:
            parts.append(f"x_synth_source_plan: {note.x_synth_source_plan}")
        parts.append("---")
        parts.append("")
    parts.append(note.body or "")
    return "\n".join(parts)
