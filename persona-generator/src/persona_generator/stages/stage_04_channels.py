"""Stage 4 — Channels (prose-only)."""

from __future__ import annotations

from typing import Any

from ._common import run_prose_stage

STAGE_ID = "stage_04_channels"
OUTPUT = "internal/channels.md"
MIN_CHARS = 3500


def run_stage_04(*, slug: str) -> dict[str, Any]:
    return run_prose_stage(
        stage_id=STAGE_ID, slug=slug, expected_relpath=OUTPUT, min_chars=MIN_CHARS
    )
