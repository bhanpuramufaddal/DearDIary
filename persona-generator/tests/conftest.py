"""Shared fixtures: temp data root, repo-root override for personas/<slug>.yaml."""

from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture
def temp_data_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "data" / "personas"
    root.mkdir(parents=True)
    monkeypatch.setenv("PERSONA_DATA_ROOT", str(root))
    return root


@pytest.fixture
def temp_personas_yaml_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect `persona_generator.tools.persona_spec._repo_root()` to a tmp dir.

    The tool writes `personas/<slug>.yaml` at repo-root level; tests need it
    isolated.
    """
    fake_root = tmp_path / "fake_repo"
    fake_root.mkdir()
    (fake_root / "personas").mkdir()
    # Override by monkeypatching the module-level helper.
    from persona_generator.tools import persona_spec as ps
    monkeypatch.setattr(ps, "_repo_root", lambda: fake_root)
    # Also for pipeline.py
    from persona_generator import pipeline as pl
    monkeypatch.setattr(pl, "_repo_root", lambda: fake_root)
    return fake_root / "personas"
