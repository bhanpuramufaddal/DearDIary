"""Stage 9b — Assembly (deterministic, no LLM).

For each morning N in Days 6–35:
  - Resolve each declared moment's final lifecycle state (apply all
    noise_effects with effective_from ≤ N).
  - Filter: lifecycle == DECLARED AND final target_morning == N.
  - Join with validation_log; keep only rows where status in {pass, correct}.
  - Apply corrected_rationale / corrected_priority overrides for 'correct' rows.
  - Walk lifecycle_history for each surviving moment.
  - Walk planned_artifacts marked is_decoy=1 with target_render_date ≤ N as
    'expected_suppressions'.
  - Write ``ideal_digests/morning_NN.json``.

No LLM. Pure SQL + Python.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from ..db import engine_for, persona_dir
from ..models import (
    DeclaredMoment,
    MomentSupportingArtifact,
    NoiseEffect,
    NoiseEvent,
    PlannedArtifact,
    ValidationLog,
)

STAGE_ID = "stage_09b_assembly"
WINDOW_START = date(2026, 4, 19)
EVAL_START = date(2026, 4, 24)  # Day 6
EVAL_END = date(2026, 5, 23)  # Day 35


def _day_n(d: date) -> int:
    return (d - WINDOW_START).days + 1


def _padded(n: int) -> str:
    return f"{n:02d}"


def _eval_dates() -> list[date]:
    out = []
    d = EVAL_START
    while d <= EVAL_END:
        out.append(d)
        d += timedelta(days=1)
    return out


def _resolve_moment_at(
    moment: DeclaredMoment, effects: list[NoiseEffect], as_of: date, noise_by_id: dict[str, NoiseEvent]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Apply noise effects with effective_from ≤ as_of. Return (final_state, lifecycle_history)."""
    state = {
        "target_morning": moment.target_morning,
        "priority": moment.priority,
        "rationale": moment.rationale,
        "lifecycle": moment.initial_lifecycle,
    }
    history: list[dict[str, Any]] = [
        {"state": "DECLARED", "from_date": None, "by": "stage_5_authoring"}
    ]
    applicable = [e for e in effects if e.effective_from <= as_of.isoformat()]
    applicable.sort(key=lambda e: e.effective_from)
    for e in applicable:
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
        triggering_noise = noise_by_id.get(e.noise_id)
        history.append(
            {
                "state": e.effect_kind,
                "from_date": e.effective_from,
                "by": e.noise_id,
                "by_storyline": triggering_noise.storyline_id if triggering_noise else None,
                "new_target": e.new_target_morning,
                "new_priority": e.new_priority,
            }
        )
    return state, history


def _supporting_artifacts(slug: str, moment_id: str) -> list[str]:
    with Session(engine_for(slug)) as session:
        rows = session.exec(
            select(MomentSupportingArtifact).where(
                MomentSupportingArtifact.moment_id == moment_id
            )
        ).all()
    return [r.artifact_id for r in rows]


def _expected_suppressions(slug: str, as_of: date) -> list[dict[str, Any]]:
    """Decoy planned_artifacts with target_render_date in the recent past — the digest should NOT surface these."""
    cutoff_lo = (as_of - timedelta(days=2)).isoformat()
    cutoff_hi = as_of.isoformat()
    with Session(engine_for(slug)) as session:
        rows = session.exec(
            select(PlannedArtifact)
            .where(PlannedArtifact.is_decoy == 1)
            .where(PlannedArtifact.target_render_date >= cutoff_lo)
            .where(PlannedArtifact.target_render_date <= cutoff_hi)
        ).all()
    return [
        {
            "artifact_id": r.artifact_id,
            "is_decoy": True,
            "storyline_id": r.storyline_id,
            "rationale": (r.content_sketch or "decoy noise")[:200],
        }
        for r in rows
    ]


def _morning_payload(slug: str, morning: date) -> dict[str, Any]:
    with Session(engine_for(slug)) as session:
        all_moments = session.exec(select(DeclaredMoment)).all()
        all_effects = session.exec(select(NoiseEffect)).all()
        all_noise = session.exec(select(NoiseEvent)).all()
        validations = {v.moment_id: v for v in session.exec(select(ValidationLog)).all()}

    effects_by_moment: dict[str, list[NoiseEffect]] = {}
    for e in all_effects:
        effects_by_moment.setdefault(e.target_moment_id, []).append(e)

    noise_by_id = {n.noise_id: n for n in all_noise}

    items: list[dict[str, Any]] = []
    for m in all_moments:
        final, history = _resolve_moment_at(
            m, effects_by_moment.get(m.moment_id, []), morning, noise_by_id
        )
        if final["lifecycle"] != "DECLARED":
            continue
        if final["target_morning"] != morning.isoformat():
            continue
        v = validations.get(m.moment_id)
        if v is None or v.status == "fail":
            continue

        rationale = final["rationale"]
        priority = final["priority"]
        if v.status == "correct":
            if v.corrected_rationale:
                rationale = v.corrected_rationale
            if v.corrected_priority:
                priority = v.corrected_priority

        items.append(
            {
                "moment_id": m.moment_id,
                "storyline_id": m.storyline_id,
                "section": m.section,
                "priority": priority,
                "action_class": m.action_class,
                "should_draft_reply": m.action_class in {"reply_short", "dispatch_immediate"},
                "draft_tone_zone": None,
                "rationale": rationale,
                "supporting_artifact_ids": _supporting_artifacts(slug, m.moment_id),
                "lifecycle_history": history,
                "validation_status": v.status,
                "validation_log_moment_id": v.moment_id,
            }
        )

    items.sort(key=lambda it: (it["priority"], it["moment_id"]))

    return {
        "for_date": morning.isoformat(),
        "based_on_state_through": (morning - timedelta(days=1)).isoformat() + "T23:59:59-07:00",
        "items": items,
        "expected_suppressions": _expected_suppressions(slug, morning),
    }


def run_stage_09b(*, slug: str) -> dict[str, Any]:
    out_dir = persona_dir(slug) / "ideal_digests"
    out_dir.mkdir(parents=True, exist_ok=True)

    written: list[str] = []
    total_items = 0
    for morning in _eval_dates():
        n = _day_n(morning)
        payload = _morning_payload(slug, morning)
        path = out_dir / f"morning_{_padded(n)}.json"
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        written.append(path.name)
        total_items += len(payload["items"])

    return {
        "completed_stages": [STAGE_ID],
        "stage_outputs": {
            STAGE_ID: [f"wrote {len(written)} ideal_digests/morning_NN.json files; {total_items} total items"]
        },
    }
