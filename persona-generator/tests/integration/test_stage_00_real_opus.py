"""Stage 0 integration test: runs against real Anthropic API.

Gated behind ``pytest -m integration``; default-skipped. Cost per run: small
(one Opus call, ~2K tokens of system prompt + ~500 tokens of user prompt + a
~1500-token persona_origin.md response).

Requires ANTHROPIC_API_KEY in the environment (loaded from ../.env).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv
from sqlmodel import Session, select

from persona_generator.db import engine_for
from persona_generator.models import Persona
from persona_generator.stages.stage_00_spec import run_stage_00

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

pytestmark = pytest.mark.integration


def test_stage_00_avery_chen_smoke(temp_data_root, temp_personas_yaml_dir):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        pytest.skip("ANTHROPIC_API_KEY not set")

    prompt = (
        "Avery Chen is the founder/CEO of Tessera, a 12-person seed-stage B2B SaaS "
        "company; she lives in Oakland with her partner Sam and their four-year-old "
        "Wren; the next month spans an active Series A raise."
    )

    update = run_stage_00(slug="test_avery_chen_x", prompt_text=prompt, name_hint="Avery Chen")
    assert "errors" not in update or not update["errors"], update.get("errors")
    assert "stage_00_spec" in update["completed_stages"]

    persona_dir = temp_data_root / "test_avery_chen_x"
    origin = persona_dir / "internal" / "persona_origin.md"
    assert origin.exists(), f"persona_origin.md not written at {origin}"
    text = origin.read_text(encoding="utf-8")
    assert len(text) > 1200, f"persona_origin.md too short ({len(text)} chars)"
    # Must read as prose, not a Big Five table
    assert "openness" not in text.lower(), "found 'openness' — looks like a Big Five table snuck in"
    # At least 3 paragraph breaks (multi-paragraph prose)
    assert text.count("\n\n") >= 3, "expected ≥ 3 paragraph breaks; output looks too monolithic"

    yaml_path = temp_personas_yaml_dir / "test_avery_chen_x.yaml"
    assert yaml_path.exists()
    yaml_text = yaml_path.read_text()
    assert "Avery Chen" in yaml_text or "test_avery_chen_x" in yaml_text

    with Session(engine_for("test_avery_chen_x")) as session:
        row = session.exec(select(Persona).where(Persona.slug == "test_avery_chen_x")).first()
    assert row is not None
    assert row.prompt_text == prompt
    assert row.window_start_date == "2026-04-19"
    assert row.window_end_date == "2026-05-23"
    assert len(row.seed_hex) == 16
