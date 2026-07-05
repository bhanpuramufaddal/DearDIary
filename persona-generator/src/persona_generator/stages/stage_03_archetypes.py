"""Stage 3 — Day Archetypes (prose-only)."""

from __future__ import annotations

from typing import Any

from ._common import run_prose_stage

STAGE_ID = "stage_03_archetypes"
OUTPUT = "internal/day_archetypes.md"
MIN_CHARS = 5000


def run_stage_03(*, slug: str) -> dict[str, Any]:
    return run_prose_stage(
        stage_id=STAGE_ID, slug=slug, expected_relpath=OUTPUT, min_chars=MIN_CHARS
    )
