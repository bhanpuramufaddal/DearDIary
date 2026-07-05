"""Stage 1a — Life Context.

Agent reads ``personas/<slug>.yaml`` + ``internal/persona_origin.md`` and writes
``internal/life_context.md`` (6-domain multi-section prose, ~2.5–4.5K words).
"""

from __future__ import annotations

from typing import Any

from ._common import run_prose_stage

STAGE_ID = "stage_01a_life_context"
OUTPUT = "internal/life_context.md"
MIN_CHARS = 8000  # ~2.5K words of dense prose


def run_stage_01a(*, slug: str) -> dict[str, Any]:
    return run_prose_stage(
        stage_id=STAGE_ID,
        slug=slug,
        expected_relpath=OUTPUT,
        min_chars=MIN_CHARS,
    )
