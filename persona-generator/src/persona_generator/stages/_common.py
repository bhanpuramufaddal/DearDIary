"""Shared helpers for stage node functions.

Includes:
  - prompt-file loader that splits the committed stage prompts into
    (system_prompt, user_template) on the ``## User prompt template`` header.
  - a generic ``run_prose_stage`` helper for the foundation stages (1a–1d, 3, 4)
    that read upstream prose, write one markdown output, and have no DB tools.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from ..agent_runtime import (
    DEFAULT_MODEL,
    RunResult,
    run_agent,
    verify_file_exists,
)
from ..db import persona_dir

PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"
_REPO_ROOT = Path(__file__).resolve().parents[4]


def ensure_persona_spec_visible(slug: str) -> None:
    """Mirror ``<repo_root>/personas/<slug>.yaml`` into the persona's working dir.

    The committed stage prompts reference ``personas/{persona_slug}.yaml`` relative
    to the agent's cwd. We create that subpath inside ``data/personas/<slug>/`` as
    a symlink (or copy on platforms without symlinks) so the agent's ``Read`` works.
    """
    src = _REPO_ROOT / "personas" / f"{slug}.yaml"
    if not src.exists():
        return
    dst_dir = persona_dir(slug) / "personas"
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / f"{slug}.yaml"
    if dst.exists() or dst.is_symlink():
        return
    try:
        dst.symlink_to(src)
    except OSError:
        # Fallback for systems without symlink permission.
        dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")


def load_stage_prompt(stage_id: str) -> tuple[str, str]:
    """Return ``(system_prompt, user_template)`` for the given stage id.

    Splits on the first ``## User prompt template`` heading. The template is the
    next code block within that section, stripped of the surrounding ``` fences.
    Falls back to (whole_file, "") if no template section exists.
    """
    raw = (PROMPTS_DIR / f"{stage_id}.md").read_text(encoding="utf-8")
    parts = raw.split("## User prompt template", 1)
    system_prompt = parts[0].rstrip()
    user_template = ""
    if len(parts) == 2:
        section = parts[1]
        # User template ends at the next ## heading (e.g. ## Notes for the engineer)
        section_end = section.find("\n## ")
        if section_end != -1:
            section = section[:section_end]
        # Strip leading "## User prompt template" header artifacts
        # and code fences ``` ... ```
        body = section.strip()
        if body.startswith("```"):
            # remove fence opening line + closing fence
            first_nl = body.find("\n")
            body = body[first_nl + 1 :]
            if body.endswith("```"):
                body = body[: -3]
        user_template = body.strip()
    return system_prompt, user_template


def render(template: str, **vars: str) -> str:
    """Lightweight {var}-style substitution. Missing keys raise KeyError."""
    out = template
    for k, v in vars.items():
        out = out.replace("{" + k + "}", v)
    return out


def default_render_vars(slug: str) -> dict[str, str]:
    today = date.today()
    return {
        "persona_slug": slug,
        "iso_today": today.isoformat(),
        "today_human": today.strftime("%A, %B %-d, %Y"),
        "window_start_iso": "2026-04-19",
        "window_end_iso": "2026-05-23",
    }


def run_prose_stage(
    *,
    stage_id: str,
    slug: str,
    expected_relpath: str,
    extra_user_vars: dict[str, str] | None = None,
    min_chars: int = 1500,
    allowed_file_tools: tuple[str, ...] = (
        "Read", "Write", "Edit", "Glob", "WebSearch", "WebFetch",
    ),
    model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """Generic stage runner for prose-only stages.

    Loads the committed prompt, runs an agent with the file tools, and verifies
    that ``expected_relpath`` exists under ``data/<slug>/`` and is non-trivial.
    """
    ensure_persona_spec_visible(slug)
    system_prompt, user_template = load_stage_prompt(stage_id)
    vars_ = {**default_render_vars(slug), **(extra_user_vars or {})}
    system_prompt = render(system_prompt, **vars_)
    user_prompt = render(user_template or _default_user(stage_id, expected_relpath), **vars_)

    def verifier(s: str) -> tuple[bool, list[str]]:
        from ..db import persona_dir as _pd

        ok, missing = verify_file_exists(s, expected_relpath)
        if not ok:
            return ok, missing
        body = (_pd(s) / expected_relpath).read_text(encoding="utf-8")
        if len(body) < min_chars:
            return False, [f"{expected_relpath} too short ({len(body)} chars; want ≥ {min_chars})"]
        return True, []

    result: RunResult = run_agent(
        stage_id=stage_id,
        slug=slug,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        structured_tools=(),
        allowed_file_tools=allowed_file_tools,
        verifier=verifier,
        model=model,
    )
    if not result.success:
        return {
            "errors": [
                {
                    "stage": stage_id,
                    "message": result.error
                    or "missing outputs: " + ", ".join(result.missing_outputs),
                    "retry_count": 0,
                }
            ]
        }
    return {
        "completed_stages": [stage_id],
        "stage_outputs": {stage_id: [expected_relpath]},
    }


def _default_user(stage_id: str, expected_relpath: str) -> str:
    """Used only when a stage prompt file has no `## User prompt template` section."""
    return (
        f"Working directory: `data/{{persona_slug}}/`. Today is {{today_human}} ({{iso_today}}). "
        f"Produce `{expected_relpath}` per your instructions. "
        f"Read upstream files as needed, then write the output. "
        f"You are done when the file exists at the right path."
    )
