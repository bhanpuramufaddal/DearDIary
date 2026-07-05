"""RC-9 regression: when the claude-agent-sdk surfaces a terminal error but the
verifier finds the expected outputs on disk, ``run_agent`` must downgrade the
SDK error to a non-fatal note and report ``success=True``. The on-disk state
is authoritative because the agent may have produced the outputs before the
error fired (we hit this with ``is_error=True`` + ``subtype="success"`` in
production)."""

from __future__ import annotations

from pathlib import Path
from typing import AsyncIterator

import pytest

from persona_generator import agent_runtime
from persona_generator.db import init_db, persona_dir


def _fake_query_factory(behavior: str):
    """Return a callable matching ``claude_agent_sdk.query`` for monkeypatching.

    behavior="raise"  → async-iterate, then raise mid-stream (no ResultMessage).
    behavior="silent" → async-iterate with zero messages (clean exit).
    """

    async def _gen(*args, **kwargs) -> AsyncIterator:  # noqa: ARG001
        if behavior == "raise":
            raise RuntimeError("simulated SDK terminal error")
        if False:  # pragma: no cover — make this an async generator
            yield None

    def fake_query(*args, **kwargs):
        return _gen(*args, **kwargs)

    return fake_query


def test_verifier_pass_downgrades_sdk_error_to_warning(temp_data_root, monkeypatch):
    slug = "test_sdk_warning"
    init_db(slug)
    # Pre-create the file the verifier will look for, simulating the case where
    # the agent finished writing right before the SDK error fired.
    out_path = persona_dir(slug) / "internal" / "out.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("ok", encoding="utf-8")

    monkeypatch.setattr(agent_runtime, "query", _fake_query_factory("raise"))

    def verifier(s: str) -> tuple[bool, list[str]]:
        return (persona_dir(s) / "internal" / "out.md").exists(), []

    result = agent_runtime.run_agent(
        stage_id="test_stage",
        slug=slug,
        system_prompt="x",
        user_prompt="x",
        verifier=verifier,
    )
    assert result.success is True
    assert result.error is not None
    assert result.error.startswith("sdk_warning:"), result.error


def test_verifier_fail_with_sdk_error_keeps_failure(temp_data_root, monkeypatch):
    slug = "test_sdk_hard_fail"
    init_db(slug)
    monkeypatch.setattr(agent_runtime, "query", _fake_query_factory("raise"))

    def verifier(s: str) -> tuple[bool, list[str]]:
        return False, ["internal/out.md missing"]

    result = agent_runtime.run_agent(
        stage_id="test_stage",
        slug=slug,
        system_prompt="x",
        user_prompt="x",
        verifier=verifier,
    )
    assert result.success is False
    assert result.error is not None
    # On hard failure, the SDK error is preserved as-is (no sdk_warning prefix).
    assert not result.error.startswith("sdk_warning:"), result.error
    assert result.missing_outputs == ["internal/out.md missing"]
