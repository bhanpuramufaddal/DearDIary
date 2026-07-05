"""Unit tests for stages/_common.py."""

import pytest

from persona_generator.stages._common import (
    default_render_vars,
    load_stage_prompt,
    render,
)


def test_load_stage_prompt_splits_on_user_template():
    sys_, user_ = load_stage_prompt("stage_01a_life_context")
    assert "## System prompt" in sys_
    # User template was extracted (non-empty)
    assert len(user_) > 100
    # User template should reference {persona_slug}
    assert "{persona_slug}" in user_
    # System should NOT include the user-template section
    assert "## User prompt template" not in sys_


def test_load_stage_prompt_strips_notes_section():
    sys_, user_ = load_stage_prompt("stage_01a_life_context")
    # The notes section is engineer-only; it should not be in the user template
    assert "Notes for the engineer" not in user_


def test_render_substitutes_known_vars():
    template = "Hello {persona_slug}, today is {today_human}."
    out = render(template, persona_slug="avery_chen", today_human="Sunday, May 24, 2026")
    assert out == "Hello avery_chen, today is Sunday, May 24, 2026."


def test_default_render_vars_contains_expected_keys():
    v = default_render_vars("avery_chen")
    for k in ("persona_slug", "iso_today", "today_human", "window_start_iso", "window_end_iso"):
        assert k in v
    assert v["persona_slug"] == "avery_chen"
    assert v["window_start_iso"] == "2026-04-19"


@pytest.mark.parametrize(
    "stage_id",
    [
        "stage_00_spec",
        "stage_01a_life_context",
        "stage_01b_character_sketch",
        "stage_01c_judgment",
        "stage_01d_profile",
        "stage_02_cast",
        "stage_03_archetypes",
        "stage_04_channels",
    ],
)
def test_every_committed_prompt_loads(stage_id):
    sys_, _ = load_stage_prompt(stage_id)
    assert len(sys_) > 500
