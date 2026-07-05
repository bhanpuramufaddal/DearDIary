"""Stage 1d — Profile.md (DERIVED, front-stage).

Reads character_sketch + judgment + life_context and writes ``profile.md`` —
the lossy front-stage compression the digest agent reads. First-person voice.
"""

from __future__ import annotations

from typing import Any

from ._common import run_prose_stage

STAGE_ID = "stage_01d_profile"
OUTPUT = "profile.md"
MIN_CHARS = 2500  # profile is short by design


def run_stage_01d(*, slug: str) -> dict[str, Any]:
    return run_prose_stage(
        stage_id=STAGE_ID,
        slug=slug,
        expected_relpath=OUTPUT,
        min_chars=MIN_CHARS,
    )
