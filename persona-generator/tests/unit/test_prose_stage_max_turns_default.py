"""Regression: the global ``max_turns`` cap is a single high default in
``agent_runtime``, not a per-stage override. Any per-stage ``max_turns=N``
reintroduction defeats the design (which is: the cap is a safety guard against
infinite loops, not a budget the agent has to optimize against).

This pins ``MAX_TURNS_DEFAULT >= 500`` and asserts ``run_prose_stage`` does NOT
expose a ``max_turns`` parameter (it inherits the global default via
``run_agent``).
"""

from __future__ import annotations

import inspect

from persona_generator.agent_runtime import MAX_TURNS_DEFAULT, run_agent
from persona_generator.stages._common import run_prose_stage


def test_global_max_turns_default_is_generous():
    assert MAX_TURNS_DEFAULT >= 500, (
        f"MAX_TURNS_DEFAULT is {MAX_TURNS_DEFAULT}. The cap is supposed to be a "
        "safety guard against infinite loops, not a budget. Pick ≥ 500."
    )


def test_run_agent_default_inherits_global_cap():
    sig = inspect.signature(run_agent)
    param = sig.parameters["max_turns"]
    assert param.default == MAX_TURNS_DEFAULT, (
        f"run_agent's max_turns default is {param.default!r}; expected MAX_TURNS_DEFAULT "
        f"({MAX_TURNS_DEFAULT}). The global constant is the single source of truth."
    )


def test_run_prose_stage_has_no_max_turns_override():
    sig = inspect.signature(run_prose_stage)
    assert "max_turns" not in sig.parameters, (
        "run_prose_stage should NOT expose a max_turns parameter — it inherits "
        "the global cap from run_agent. Adding a per-stage override defeats the "
        "single-source-of-truth design."
    )
