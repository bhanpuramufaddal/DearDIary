"""Stage 1c — Judgment Reasoning.

Agent reads the foundation produced so far and writes ``internal/judgment.md``
(essay: how this persona decides what matters this month).
"""

from __future__ import annotations

from typing import Any

from ._common import run_prose_stage

STAGE_ID = "stage_01c_judgment"
OUTPUT = "internal/judgment.md"
MIN_CHARS = 7000


def run_stage_01c(*, slug: str) -> dict[str, Any]:
    return run_prose_stage(
        stage_id=STAGE_ID,
        slug=slug,
        expected_relpath=OUTPUT,
        min_chars=MIN_CHARS,
    )
