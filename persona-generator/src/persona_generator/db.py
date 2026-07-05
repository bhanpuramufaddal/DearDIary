"""Per-persona SQLite engine + session factory.

One DB file per persona at ``<DATA_ROOT>/<slug>/persona.db``. WAL mode on every
connection (concurrent reads OK during writes; required so the service-emulator
can read while the generator writes).

DATA_ROOT defaults to ``<repo_root>/data/personas``; override with
``PERSONA_DATA_ROOT`` env var (useful for tests, which point at tmp dirs).
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

# Resolve repo root: persona-generator/src/persona_generator/db.py → repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]


def data_root() -> Path:
    override = os.environ.get("PERSONA_DATA_ROOT")
    if override:
        return Path(override)
    return _REPO_ROOT / "data" / "personas"


def persona_dir(slug: str) -> Path:
    return data_root() / slug


def db_path(slug: str) -> Path:
    return persona_dir(slug) / "persona.db"


@event.listens_for(Engine, "connect")
def _enable_wal(dbapi_connection, connection_record):  # noqa: ARG001
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def engine_for(slug: str) -> Engine:
    persona_dir(slug).mkdir(parents=True, exist_ok=True)
    return create_engine(f"sqlite:///{db_path(slug)}", echo=False)


def init_db(slug: str) -> Engine:
    """Create the DB file if missing and ensure all known tables exist."""
    eng = engine_for(slug)
    SQLModel.metadata.create_all(eng)
    return eng


@contextmanager
def session_for(slug: str) -> Iterator[Session]:
    eng = engine_for(slug)
    with Session(eng) as session:
        yield session
