"""Phase B integration: Stages 1a → 1d chained against real Opus.

One sequential run produces life_context.md, character_sketch.md, judgment.md,
profile.md for one disposable test persona. Structural assertions per stage.

Cost note: ~4 LLM calls totaling ~30–50K tokens (read-side mostly cached).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

from persona_generator.db import persona_dir
from persona_generator.stages.stage_00_spec import run_stage_00
from persona_generator.stages.stage_01a_life_context import run_stage_01a
from persona_generator.stages.stage_01b_character_sketch import run_stage_01b
from persona_generator.stages.stage_01c_judgment import run_stage_01c
from persona_generator.stages.stage_01d_profile import run_stage_01d

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

pytestmark = pytest.mark.integration


PROMPT = (
    "Mira Patel is a Series-B product engineering manager at a 250-person fintech "
    "in NYC. Married to Joel, two kids ages 7 and 4. The next month is a re-org: "
    "her team is being merged with platform infra and she'll keep eight people, lose "
    "two, and gain a tech-lead with unclear authority."
)


def test_phase_b_chained_run(temp_data_root, temp_personas_yaml_dir):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        pytest.skip("ANTHROPIC_API_KEY not set")

    slug = "test_mira_patel_x"

    # Stage 0 — set up the spec + persona_origin.
    s0 = run_stage_00(slug=slug, prompt_text=PROMPT, name_hint="Mira Patel")
    assert "errors" not in s0 or not s0["errors"], s0.get("errors")

    pdir = persona_dir(slug)
    assert (pdir / "internal" / "persona_origin.md").exists()

    # Stage 1a — Life Context
    s1a = run_stage_01a(slug=slug)
    assert "errors" not in s1a or not s1a["errors"], s1a.get("errors")
    lc = pdir / "internal" / "life_context.md"
    assert lc.exists()
    lc_text = lc.read_text(encoding="utf-8")
    assert len(lc_text) >= 8000, f"life_context too short: {len(lc_text)} chars"
    # six required domain headings (case-insensitive)
    lower = lc_text.lower()
    for domain in ("professional", "family", "health", "relationships", "finances", "identity"):
        assert domain in lower, f"life_context missing domain: {domain}"

    # Stage 1b — Character Sketch
    s1b = run_stage_01b(slug=slug)
    assert "errors" not in s1b or not s1b["errors"], s1b.get("errors")
    cs = pdir / "internal" / "character_sketch.md"
    assert cs.exists()
    cs_text = cs.read_text(encoding="utf-8")
    assert len(cs_text) >= 8000, f"character_sketch too short: {len(cs_text)} chars"
    # No Big Five score prelude
    assert "openness:" not in cs_text.lower()
    assert "neuroticism:" not in cs_text.lower()

    # Stage 1c — Judgment
    s1c = run_stage_01c(slug=slug)
    assert "errors" not in s1c or not s1c["errors"], s1c.get("errors")
    jm = pdir / "internal" / "judgment.md"
    assert jm.exists()
    jm_text = jm.read_text(encoding="utf-8")
    assert len(jm_text) >= 7000, f"judgment too short: {len(jm_text)} chars"

    # Stage 1d — Profile (the lossy front-stage compression)
    s1d = run_stage_01d(slug=slug)
    assert "errors" not in s1d or not s1d["errors"], s1d.get("errors")
    pf = pdir / "profile.md"
    assert pf.exists()
    pf_text = pf.read_text(encoding="utf-8")
    assert len(pf_text) >= 2500, f"profile too short: {len(pf_text)} chars"
    # Profile must be shorter than character_sketch (it's the compression)
    assert len(pf_text) < len(cs_text), "profile.md should be shorter than character_sketch.md"
    # First-person voice signal: should contain "I" or "my" somewhere prominent
    lower_pf = pf_text.lower()
    assert any(tok in lower_pf for tok in (" i ", "i'm", "my ", "i've")), (
        "profile.md doesn't read as first-person"
    )
