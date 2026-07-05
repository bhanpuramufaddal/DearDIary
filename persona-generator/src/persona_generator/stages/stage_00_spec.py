"""Stage 0 — Spec Seed.

Pre-computes deterministic identity (slug, seed_hex, window dates) and runs an
agent that:
  - writes ``internal/persona_origin.md`` (a magazine-feature opening for the
    persona) via the file ``Write`` tool, AND
  - calls ``write_persona_spec`` once with the orchestrator-provided values.

Verifier passes when both outputs exist (file + DB row).
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from ..agent_runtime import run_agent, verify_file_exists
from ..db import engine_for, persona_dir
from ..models import Persona
from ..tools.persona_spec import build_write_persona_spec

WINDOW_START = "2026-04-19"
WINDOW_END = "2026-05-23"

PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"


def derive_seed_hex(prompt_text: str) -> str:
    return hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()[:16]


def _system_prompt() -> str:
    raw = (PROMPTS_DIR / "stage_00_spec.md").read_text(encoding="utf-8")
    # The committed prompt file has both system + user template; for now take it whole as
    # the system prompt. Later stages may split this.
    return raw


def _verifier(slug: str) -> tuple[bool, list[str]]:
    file_ok, missing_files = verify_file_exists(slug, "internal/persona_origin.md")
    db_ok = True
    db_missing: list[str] = []
    engine = engine_for(slug)
    with Session(engine) as session:
        row = session.exec(select(Persona).where(Persona.slug == slug)).first()
        if row is None:
            db_ok = False
            db_missing.append("personas[slug=" + slug + "]")
    return (file_ok and db_ok, missing_files + db_missing)


def _already_complete(slug: str) -> bool:
    # DB must exist before the verifier can query it.
    from ..db import init_db

    init_db(slug)
    ok, _ = _verifier(slug)
    return ok


def run_stage_00(*, slug: str, prompt_text: str, name_hint: str | None = None) -> dict[str, Any]:
    """LangGraph node entrypoint. Returns a partial state update."""

    from ..db import init_db

    # Pre-init the DB so observability + idempotency check have somewhere to land.
    init_db(slug)
    persona_dir(slug).mkdir(parents=True, exist_ok=True)
    (persona_dir(slug) / "internal").mkdir(exist_ok=True)

    if _already_complete(slug):
        return {
            "completed_stages": ["stage_00_spec"],
            "stage_outputs": {
                "stage_00_spec": ["internal/persona_origin.md", "personas table"]
            },
        }

    seed_hex = derive_seed_hex(prompt_text)
    name_hint_section = (
        f"Suggested display name (you may refine if needed): {name_hint}\n" if name_hint else ""
    )

    user_prompt = f"""\
You are creating persona seed data for a synthetic dataset pipeline.

Pre-computed values (use these verbatim; do not re-derive):
  slug:               {slug}
  seed_hex:           {seed_hex}
  window_start_date:  {WINDOW_START}
  window_end_date:    {WINDOW_END}

User's free-form prompt (verbatim):
\"\"\"
{prompt_text}
\"\"\"

{name_hint_section}
Do the following, in order:

1. Use the `Write` tool to create `internal/persona_origin.md` — a 3–6 paragraph magazine-feature opening introducing the persona. Where they are in life right now. The biographical anchor everything else hangs from. Prose only. No bulleted lists.

2. Call the `write_persona_spec` MCP tool exactly once with the pre-computed values above (slug, seed_hex, window dates) and the display name you extracted from the prompt. The tool will write `personas/{slug}.yaml` and insert the `personas` row.

You are done after step 2. Do not write any other files.
"""

    tool_fn = build_write_persona_spec(slug=slug, expected_seed_hex=seed_hex)

    result = run_agent(
        stage_id="stage_00_spec",
        slug=slug,
        system_prompt=_system_prompt(),
        user_prompt=user_prompt,
        structured_tools=[tool_fn],
        allowed_file_tools=["Write"],
        verifier=_verifier,
    )

    if not result.success:
        return {
            "errors": [
                {
                    "stage": "stage_00_spec",
                    "message": result.error or "missing outputs: " + ", ".join(result.missing_outputs),
                    "retry_count": 0,
                }
            ]
        }

    return {
        "completed_stages": ["stage_00_spec"],
        "persona_slug": slug,
        "prompt_text": prompt_text,
        "window_start_date": WINDOW_START,
        "window_end_date": WINDOW_END,
        "stage_outputs": {
            "stage_00_spec": ["internal/persona_origin.md", "personas table"]
        },
    }
