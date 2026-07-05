"""Stage 9a — Validation.

For every declared_moment whose FINAL lifecycle state (after applying
noise_effects with effective_from ≤ target_morning) is DECLARED and whose
target_morning falls in Days 6–35, spawn one validation agent. Each agent
emits exactly one row in validation_log via the three validation_* tools.

This is the heaviest LLM workload after Stage 7 in volume (~40–150 calls per
persona), but each call is short (6–15 tool calls). Uses Haiku 4.5.

Currently sequential; LangGraph Send-based parallel fan-out is a future
optimization (see design/08-validation-and-assembly.md).
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from sqlmodel import Session, select

from ..agent_runtime import HAIKU_MODEL, RunResult, run_agent
from ..db import engine_for
from ..models import DeclaredMoment, MomentSupportingArtifact, NoiseEffect, ValidationLog
from ..tools.validation import (
    build_validation_correct,
    build_validation_fail,
    build_validation_pass,
)
from ._common import default_render_vars, ensure_persona_spec_visible, load_stage_prompt, render

STAGE_ID = "stage_09a_validation"
WINDOW_START = date(2026, 4, 19)
EVAL_START = date(2026, 4, 24)  # Day 6
EVAL_END = date(2026, 5, 23)  # Day 35


def _day_n(iso_date: str) -> int:
    return (date.fromisoformat(iso_date) - WINDOW_START).days + 1


def _final_state(slug: str, moment: DeclaredMoment) -> dict[str, Any]:
    """Apply all noise_effects with effective_from ≤ moment.target_morning to compute final state.

    Returns dict with final target_morning, priority, rationale, and lifecycle (DECLARED | CANCELED | etc).
    Also returns lifecycle_history as a list of state transitions.
    """
    with Session(engine_for(slug)) as session:
        effects = session.exec(
            select(NoiseEffect)
            .where(NoiseEffect.target_moment_id == moment.moment_id)
            .where(NoiseEffect.effective_from <= moment.target_morning)
            .order_by(NoiseEffect.effective_from)  # type: ignore
        ).all()

    state = {
        "target_morning": moment.target_morning,
        "priority": moment.priority,
        "rationale": moment.rationale,
        "lifecycle": moment.initial_lifecycle,
    }
    history: list[dict[str, Any]] = [
        {"state": "DECLARED", "from_date": None, "by": "stage_5_authoring"}
    ]
    for e in effects:
        if e.effect_kind == "SHIFTED" and e.new_target_morning:
            state["target_morning"] = e.new_target_morning
        if e.effect_kind == "CANCELED":
            state["lifecycle"] = "CANCELED"
        if e.effect_kind == "MODIFIED":
            if e.new_rationale:
                state["rationale"] = e.new_rationale
            if e.new_priority:
                state["priority"] = e.new_priority
        if e.effect_kind == "DECLARED":
            state["lifecycle"] = "DECLARED"
        history.append(
            {
                "state": e.effect_kind,
                "from_date": e.effective_from,
                "by": f"noise_effect_{e.effect_id}",
                "new_target_morning": e.new_target_morning,
                "new_priority": e.new_priority,
            }
        )
    return {"state": state, "history": history}


def _moments_to_validate(slug: str) -> list[tuple[DeclaredMoment, dict[str, Any]]]:
    with Session(engine_for(slug)) as session:
        all_moments = session.exec(select(DeclaredMoment)).all()
    out: list[tuple[DeclaredMoment, dict[str, Any]]] = []
    for m in all_moments:
        resolved = _final_state(slug, m)
        final = resolved["state"]
        if final["lifecycle"] != "DECLARED":
            continue
        if not (EVAL_START.isoformat() <= final["target_morning"] <= EVAL_END.isoformat()):
            continue
        out.append((m, resolved))
    return out


def _other_active_at(slug: str, target_morning: str, exclude_moment_id: str) -> list[str]:
    """Find other moments whose final state is DECLARED at the same morning."""
    moments = _moments_to_validate(slug)
    return [
        m.moment_id
        for (m, r) in moments
        if m.moment_id != exclude_moment_id and r["state"]["target_morning"] == target_morning
    ]


def _per_moment_user_prompt(
    slug: str, moment: DeclaredMoment, resolved: dict[str, Any]
) -> str:
    final = resolved["state"]
    n = _day_n(final["target_morning"])
    prior_n = n - 1
    prior_iso = (WINDOW_START.fromordinal(WINDOW_START.toordinal() + prior_n - 1)).isoformat()
    declared_on = _day_n(moment.target_morning)
    with Session(engine_for(slug)) as session:
        supporting = [
            r.artifact_id
            for r in session.exec(
                select(MomentSupportingArtifact).where(
                    MomentSupportingArtifact.moment_id == moment.moment_id
                )
            ).all()
        ]
    others = _other_active_at(slug, final["target_morning"], moment.moment_id)
    return f"""You are validating ONE declared digest moment for persona `{slug}`.

**Moment under review:**
- `moment_id`: `{moment.moment_id}`
- `target_morning`: Day {n} ({final["target_morning"]})
- `section`: `{moment.section}`
- `priority`: `{final["priority"]}`
- `action_class`: `{moment.action_class}`
- `rationale`: {final["rationale"]}
- `supporting_artifact_ids`: {json.dumps(supporting)}
- `declared_on_day`: {declared_on}
- `lifecycle_history`: {json.dumps(resolved["history"])}

**Other active moments at the same morning (Day {n}):** {json.dumps(others[:10])}

**Persona "now":** end of Day {prior_n} ({prior_iso}). You may consult any persona file whose contents reflect events on or before this timestamp. Do not consult future days.

**Key starting points on disk:**
- Supporting artifacts in `persona.db` (query emails/notes by artifact_id)
- Yesterday's state: `internal/daily_state/day_{prior_n:02d}.md`
- Persona judgment / voice reference: `internal/judgment.md`, `internal/character_sketch.md`

Do your checks (coherence, currency, cross-item consistency, persona fit, cascade integrity), then call exactly one of `validation_pass`, `validation_fail`, or `validation_correct` with `moment_id="{moment.moment_id}"`. Stop.
"""


def run_stage_09a(*, slug: str, force_revalidate: bool = False) -> dict[str, Any]:
    ensure_persona_spec_visible(slug)
    moments = _moments_to_validate(slug)
    if not moments:
        return {
            "completed_stages": [STAGE_ID],
            "stage_outputs": {STAGE_ID: ["no active moments in eval window"]},
        }

    system_prompt, _ = load_stage_prompt(STAGE_ID)
    vars_ = default_render_vars(slug)
    system_prompt = render(system_prompt, **vars_)

    tools = (
        build_validation_pass(slug=slug),
        build_validation_fail(slug=slug),
        build_validation_correct(slug=slug),
    )

    errors: list[dict[str, Any]] = []
    validated = 0
    skipped = 0

    for moment, resolved in moments:
        if not force_revalidate:
            with Session(engine_for(slug)) as session:
                if session.get(ValidationLog, moment.moment_id) is not None:
                    skipped += 1
                    continue

        user_prompt = _per_moment_user_prompt(slug, moment, resolved)

        def _verifier(s: str, _mid=moment.moment_id) -> tuple[bool, list[str]]:
            with Session(engine_for(s)) as session:
                if session.get(ValidationLog, _mid) is None:
                    return False, [f"validation_log row missing for {_mid}"]
            return True, []

        result: RunResult = run_agent(
            stage_id=f"{STAGE_ID}__{moment.moment_id[:32]}",
            slug=slug,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            structured_tools=tools,
            allowed_file_tools=("Read", "Glob"),
            verifier=_verifier,
            model=HAIKU_MODEL,
        )
        if not result.success:
            errors.append(
                {
                    "stage": STAGE_ID,
                    "message": f"{moment.moment_id}: {result.error or 'no validation_log row'}",
                    "retry_count": 0,
                }
            )
            continue
        validated += 1

    return {
        "completed_stages": [STAGE_ID] if not errors else [],
        "errors": errors,
        "stage_outputs": {
            STAGE_ID: [f"validated={validated}, skipped(already-done)={skipped}, total={len(moments)}"]
        },
    }
