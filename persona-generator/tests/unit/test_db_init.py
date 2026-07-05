"""DB initialization: file created, tables exist, WAL enabled."""

import sqlite3

from sqlmodel import Session, select

from persona_generator.db import db_path, engine_for, init_db
from persona_generator.models import Persona


def test_init_db_creates_file_and_tables(temp_data_root):
    engine = init_db("test_slug")
    assert db_path("test_slug").exists()
    # Walk via raw sqlite3 to read PRAGMA + table list
    conn = sqlite3.connect(str(db_path("test_slug")))
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() == "wal"
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        assert "personas" in tables
        assert "agent_runs" in tables
        assert "agent_tool_calls" in tables
        assert "llm_calls" in tables
    finally:
        conn.close()


def test_persona_round_trip(temp_data_root):
    init_db("test_slug")
    with Session(engine_for("test_slug")) as session:
        session.add(
            Persona(
                slug="test_slug",
                name="Test Persona",
                prompt_text="A prompt.",
                seed_hex="0123456789abcdef",
                window_start_date="2026-04-19",
                window_end_date="2026-05-23",
                created_at="2026-04-19T00:00:00+00:00",
            )
        )
        session.commit()
    with Session(engine_for("test_slug")) as session:
        row = session.exec(select(Persona).where(Persona.slug == "test_slug")).first()
    assert row is not None
    assert row.name == "Test Persona"
    assert row.seed_hex == "0123456789abcdef"
