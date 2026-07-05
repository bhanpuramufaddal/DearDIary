"""Stage 0 structured tool: `write_persona_spec`.

INSERTs a `personas` row in the per-persona SQLite DB and writes a
`personas/<slug>.yaml` sidecar at the repo root (intended to be committed).
The agent should call this once per Stage 0 invocation.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

import yaml
from claude_agent_sdk import tool
from sqlmodel import Session

from ..db import data_root, engine_for
from ..models import Persona


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _personas_yaml_dir() -> Path:
    """Committed-yaml sidecar directory at the repo root."""
    p = _repo_root() / "personas"
    p.mkdir(parents=True, exist_ok=True)
    return p


def build_write_persona_spec(*, slug: str, expected_seed_hex: str | None = None):
    """Construct the @tool callable for a specific slug.

    The orchestrator pre-computes ``slug`` and (optionally) the deterministic
    ``seed_hex``. The agent passes them through; this tool enforces consistency.
    """

    @tool(
        "write_persona_spec",
        "Write the persona's identity row to persona.db and a personas/<slug>.yaml "
        "sidecar. Call this exactly once per Stage 0 invocation.",
        {
            "slug": Annotated[str, "Persona slug; must match the orchestrator-provided slug."],
            "name": Annotated[str, "Display name, e.g. 'Avery Chen'."],
            "prompt_text": Annotated[str, "Verbatim user prompt that produced this persona."],
            "seed_hex": Annotated[str, "16-char hex seed; must match the orchestrator's seed_hex."],
            "window_start_date": Annotated[str, "ISO date, Day 1 of the 35-day window (e.g. 2026-04-19)."],
            "window_end_date": Annotated[str, "ISO date, Day 35 of the 35-day window (e.g. 2026-05-23)."],
        },
    )
    async def write_persona_spec(args: dict[str, Any]) -> dict[str, Any]:
        if args["slug"] != slug:
            return _err(f"slug mismatch: tool got '{args['slug']}', expected '{slug}'")
        if expected_seed_hex is not None and args["seed_hex"] != expected_seed_hex:
            return _err(
                f"seed_hex mismatch: tool got '{args['seed_hex']}', expected '{expected_seed_hex}'"
            )

        created_at = datetime.now(timezone.utc).isoformat()
        row = Persona(
            slug=args["slug"],
            name=args["name"],
            prompt_text=args["prompt_text"],
            seed_hex=args["seed_hex"],
            window_start_date=args["window_start_date"],
            window_end_date=args["window_end_date"],
            created_at=created_at,
        )

        engine = engine_for(slug)
        with Session(engine) as session:
            existing = session.get(Persona, slug)
            if existing is None:
                session.add(row)
            else:
                # Idempotent: re-running Stage 0 is a no-op if the row matches.
                for col in (
                    "name",
                    "prompt_text",
                    "seed_hex",
                    "window_start_date",
                    "window_end_date",
                ):
                    setattr(existing, col, getattr(row, col))
                session.add(existing)
            session.commit()

        yaml_path = _personas_yaml_dir() / f"{slug}.yaml"
        yaml_path.write_text(
            yaml.safe_dump(
                {
                    "slug": slug,
                    "name": args["name"],
                    "prompt_text": args["prompt_text"],
                    "seed_hex": args["seed_hex"],
                    "window_start_date": args["window_start_date"],
                    "window_end_date": args["window_end_date"],
                    "created_at": created_at,
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )

        # Also ensure the runtime working dir exists
        (data_root() / slug).mkdir(parents=True, exist_ok=True)

        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "ok": True,
                            "yaml_path": str(yaml_path),
                            "db_path": str(engine.url),
                        }
                    ),
                }
            ]
        }

    return write_persona_spec


def _err(msg: str) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps({"ok": False, "error": msg})}],
        "isError": True,
    }
