"""Stage 1b — Character Sketch.

Agent reads ``persona_origin.md`` + ``life_context.md`` and writes
``internal/character_sketch.md`` (the novelist's bible, 2–4K words of prose).
"""

from __future__ import annotations

from typing import Any

from ._common import run_prose_stage

STAGE_ID = "stage_01b_character_sketch"
OUTPUT = "internal/character_sketch.md"
MIN_CHARS = 8000


def run_stage_01b(*, slug: str) -> dict[str, Any]:
    return run_prose_stage(
        stage_id=STAGE_ID,
        slug=slug,
        expected_relpath=OUTPUT,
        min_chars=MIN_CHARS,
    )
