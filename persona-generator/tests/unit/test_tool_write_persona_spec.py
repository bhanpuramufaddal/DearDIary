"""`write_persona_spec` tool inserts the row + writes the yaml sidecar."""

import asyncio
import json

import yaml
from sqlmodel import Session, select

from persona_generator.db import engine_for, init_db
from persona_generator.models import Persona
from persona_generator.tools.persona_spec import build_write_persona_spec


def _call(tool, args: dict) -> dict:
    """Invoke an SdkMcpTool's handler synchronously (it's actually async)."""
    return asyncio.run(tool.handler(args))


def test_writes_yaml_and_row(temp_data_root, temp_personas_yaml_dir):
    init_db("test_slug")
    tool = build_write_persona_spec(slug="test_slug", expected_seed_hex="0123456789abcdef")
    result = _call(
        tool,
        {
            "slug": "test_slug",
            "name": "Test Persona",
            "prompt_text": "Test prompt.",
            "seed_hex": "0123456789abcdef",
            "window_start_date": "2026-04-19",
            "window_end_date": "2026-05-23",
        },
    )
    assert result.get("isError") is not True
    body = json.loads(result["content"][0]["text"])
    assert body["ok"] is True

    yaml_path = temp_personas_yaml_dir / "test_slug.yaml"
    assert yaml_path.exists()
    parsed = yaml.safe_load(yaml_path.read_text())
    assert parsed["slug"] == "test_slug"
    assert parsed["seed_hex"] == "0123456789abcdef"
    assert parsed["prompt_text"] == "Test prompt."

    with Session(engine_for("test_slug")) as session:
        row = session.exec(select(Persona).where(Persona.slug == "test_slug")).first()
    assert row is not None
    assert row.name == "Test Persona"


def test_slug_mismatch_returns_error(temp_data_root, temp_personas_yaml_dir):
    init_db("test_slug")
    tool = build_write_persona_spec(slug="test_slug", expected_seed_hex=None)
    result = _call(
        tool,
        {
            "slug": "WRONG",
            "name": "X",
            "prompt_text": "p",
            "seed_hex": "0123456789abcdef",
            "window_start_date": "2026-04-19",
            "window_end_date": "2026-05-23",
        },
    )
    assert result.get("isError") is True


def test_seed_hex_mismatch_returns_error(temp_data_root, temp_personas_yaml_dir):
    init_db("test_slug")
    tool = build_write_persona_spec(slug="test_slug", expected_seed_hex="aaaaaaaaaaaaaaaa")
    result = _call(
        tool,
        {
            "slug": "test_slug",
            "name": "X",
            "prompt_text": "p",
            "seed_hex": "bbbbbbbbbbbbbbbb",
            "window_start_date": "2026-04-19",
            "window_end_date": "2026-05-23",
        },
    )
    assert result.get("isError") is True


def test_idempotent_re_run(temp_data_root, temp_personas_yaml_dir):
    init_db("test_slug")
    tool = build_write_persona_spec(slug="test_slug", expected_seed_hex="0123456789abcdef")
    args = {
        "slug": "test_slug",
        "name": "Test Persona",
        "prompt_text": "Test prompt.",
        "seed_hex": "0123456789abcdef",
        "window_start_date": "2026-04-19",
        "window_end_date": "2026-05-23",
    }
    _call(tool, args)
    _call(tool, args)  # second call should not raise
    with Session(engine_for("test_slug")) as session:
        rows = session.exec(select(Persona).where(Persona.slug == "test_slug")).all()
    assert len(rows) == 1
