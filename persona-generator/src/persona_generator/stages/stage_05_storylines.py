"""Stage 5 — Storylines + plans, 3-phase architecture.

Phase A (Storyline Index):
  - One Opus agent reads upstream foundation and decides 5–10 storylines
    (including a mandatory `background_noise` storyline).
  - Writes `internal/storylines_index.md` (one paragraph per storyline) and
    INSERTs rows into ``storylines``. No moments/artifacts/noise yet.

Phase B (Per-storyline detail):
  - For each non-background storyline, one Opus sub-agent authors the full
    surface area: arc.md + planned_artifacts + declared_moments + within-
    storyline noise events.
  - Sub-agents run sequentially. Each is one-shot; no retries.

Phase C (Cross-storyline coordination):
  - One Opus agent declares cross-storyline noise events and the storyline-
    agnostic decoys that populate the `background_noise` storyline.

Cross-call referential integrity is verified at the end via a sweep. No retry.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from ..agent_runtime import run_agent, verify_file_exists
from ..db import engine_for, persona_dir
from ..models import (
    DeclaredMoment,
    MomentSupportingArtifact,
    NoiseEffect,
    NoiseEvent,
    PlannedArtifact,
    Storyline,
)
from ..tools.cast import build_add_cast_member
from ..tools.storyline import (
    build_add_storyline,
    build_declare_digest_moment,
    build_declare_noise_event,
    build_declare_planned_artifact,
)
from ._common import default_render_vars, ensure_persona_spec_visible, load_stage_prompt, render

STAGE_ID = "stage_05_storylines"
BACKGROUND_STORYLINE_ID = "background_noise"

MIN_STORYLINES = 5
MIN_MOMENTS = 40
MIN_NOISE_EVENTS = 10
# No MIN_PLANNED_ARTIFACTS — artifact density is taught by the per-storyline
# prompt's few-shot BAD/GOOD pairs, not enforced by a numeric floor.


# ---------------------------------------------------------------------------
# Phase A — Storyline Index
# ---------------------------------------------------------------------------


def _phase_a_verifier(slug: str) -> tuple[bool, list[str]]:
    """Phase A: index file exists; ≥ MIN_STORYLINES rows including background_noise."""
    errors: list[str] = []
    ok, missing = verify_file_exists(slug, "internal/storylines_index.md")
    if not ok:
        errors.extend(missing)

    with Session(engine_for(slug)) as session:
        rows = session.exec(select(Storyline)).all()
        ids = {r.storyline_id for r in rows}
        if len(rows) < MIN_STORYLINES:
            errors.append(f"storylines: have {len(rows)}, want ≥ {MIN_STORYLINES}")
        if BACKGROUND_STORYLINE_ID not in ids:
            errors.append(
                f"missing required storyline '{BACKGROUND_STORYLINE_ID}' "
                "(holder for storyline-agnostic decoys; Phase A must create it)"
            )
    return (not errors, errors)


def _phase_a_already_done(slug: str) -> bool:
    """Phase A is done if storylines_index.md exists, ≥ MIN_STORYLINES rows
    are in the storylines table, and background_noise is one of them. A kill+
    restart in the middle of Phase B (or later) shouldn't redo Phase A's LLM
    work — its outputs are stable and idempotent."""
    if not (persona_dir(slug) / "internal" / "storylines_index.md").exists():
        return False
    with Session(engine_for(slug)) as session:
        rows = session.exec(select(Storyline)).all()
        ids = {r.storyline_id for r in rows}
    return len(rows) >= MIN_STORYLINES and BACKGROUND_STORYLINE_ID in ids


def _run_phase_a(slug: str) -> tuple[bool, list[str]]:
    if _phase_a_already_done(slug):
        return (True, [])
    system_prompt, user_template = load_stage_prompt("stage_05a_storyline_index")
    vars_ = default_render_vars(slug)
    system_prompt = render(system_prompt, **vars_)
    user_prompt = render(user_template, **vars_)

    tools = [build_add_storyline(slug=slug)]

    result = run_agent(
        stage_id=f"{STAGE_ID}_phase_a",
        slug=slug,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        structured_tools=tools,
        allowed_file_tools=["Read", "Write", "Edit", "Glob", "WebSearch", "WebFetch"],
        verifier=_phase_a_verifier,
    )
    return (result.success, result.missing_outputs if not result.success else [])


# ---------------------------------------------------------------------------
# Phase B — Per-storyline detail
# ---------------------------------------------------------------------------


def _extract_storyline_summary(slug: str, storyline_id: str) -> str:
    """Pull the paragraph for ``storyline_id`` out of storylines_index.md.

    Heuristic: find the line containing the storyline_id (in backticks or bold)
    and return that paragraph (up to a blank line). Falls back to the whole file
    if we can't isolate the paragraph.
    """
    index_path = persona_dir(slug) / "internal" / "storylines_index.md"
    if not index_path.exists():
        return ""
    body = index_path.read_text(encoding="utf-8")
    paragraphs = body.split("\n\n")
    for p in paragraphs:
        if storyline_id in p:
            return p.strip()
    return body[:2000]


def _phase_b_verifier_for(storyline_id: str):
    def _v(slug: str) -> tuple[bool, list[str]]:
        errors: list[str] = []
        arc_path = f"internal/storylines/{storyline_id}/arc.md"
        ok, missing = verify_file_exists(slug, arc_path)
        if not ok:
            errors.extend(missing)
        with Session(engine_for(slug)) as session:
            n_moments = len(
                session.exec(
                    select(DeclaredMoment).where(DeclaredMoment.storyline_id == storyline_id)
                ).all()
            )
            n_artifacts = len(
                session.exec(
                    select(PlannedArtifact).where(PlannedArtifact.storyline_id == storyline_id)
                ).all()
            )
        if n_moments < 1:
            errors.append(
                f"storyline '{storyline_id}' has 0 declared_moments; need ≥ 1"
            )
        if n_artifacts < 1:
            errors.append(
                f"storyline '{storyline_id}' has 0 planned_artifacts; need ≥ 1"
            )
        return (not errors, errors)

    return _v


def _phase_b_already_done(slug: str, storyline_id: str) -> bool:
    """Per-storyline idempotency: skip if arc.md exists AND ≥1 moment AND ≥1 artifact.

    This makes Stage 5 resumable mid-Phase-B: a kill+restart will redo Phase A
    (idempotent — overwrites on PK), skip the storylines whose detail is already
    in DB + on disk, and run Phase B only for the unfinished ones.
    """
    arc_path = persona_dir(slug) / "internal" / "storylines" / storyline_id / "arc.md"
    if not arc_path.exists():
        return False
    with Session(engine_for(slug)) as session:
        n_moments = len(
            session.exec(
                select(DeclaredMoment).where(DeclaredMoment.storyline_id == storyline_id)
            ).all()
        )
        n_artifacts = len(
            session.exec(
                select(PlannedArtifact).where(PlannedArtifact.storyline_id == storyline_id)
            ).all()
        )
    return n_moments >= 1 and n_artifacts >= 1


def _run_phase_b_one(slug: str, *, storyline_id: str, storyline_display_name: str) -> tuple[bool, list[str]]:
    if _phase_b_already_done(slug, storyline_id):
        return (True, [])
    system_prompt, user_template = load_stage_prompt("stage_05b_per_storyline")
    storyline_summary = _extract_storyline_summary(slug, storyline_id)
    vars_ = {
        **default_render_vars(slug),
        "storyline_id": storyline_id,
        "storyline_display_name": storyline_display_name,
        "storyline_summary": storyline_summary,
    }
    system_prompt = render(system_prompt, **vars_)
    user_prompt = render(user_template, **vars_)

    tools = [
        build_declare_planned_artifact(slug=slug),
        build_declare_digest_moment(slug=slug),
        build_declare_noise_event(slug=slug),
        build_add_cast_member(slug=slug),
    ]

    result = run_agent(
        stage_id=f"{STAGE_ID}_phase_b__{storyline_id[:32]}",
        slug=slug,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        structured_tools=tools,
        allowed_file_tools=["Read", "Write", "Edit", "Glob", "WebSearch", "WebFetch"],
        verifier=_phase_b_verifier_for(storyline_id),
    )
    return (result.success, result.missing_outputs if not result.success else [])


# ---------------------------------------------------------------------------
# Phase C — Cross-storyline coordination
# ---------------------------------------------------------------------------


def _moments_dump(slug: str) -> str:
    with Session(engine_for(slug)) as session:
        rows = session.exec(select(DeclaredMoment)).all()
    lines = []
    for m in rows:
        rationale_short = (m.rationale or "")[:80].replace("\n", " ")
        lines.append(
            f"{m.moment_id} | {m.storyline_id} | {m.target_morning} | "
            f"{m.section} | {m.priority} | {m.action_class} | {rationale_short}"
        )
    return "\n".join(lines)


def _phase_c_verifier(slug: str) -> tuple[bool, list[str]]:
    errors: list[str] = []
    bg_arc = f"internal/storylines/{BACKGROUND_STORYLINE_ID}/arc.md"
    ok, missing = verify_file_exists(slug, bg_arc)
    if not ok:
        errors.extend(missing)

    with Session(engine_for(slug)) as session:
        bg_decoys = session.exec(
            select(PlannedArtifact).where(
                PlannedArtifact.storyline_id == BACKGROUND_STORYLINE_ID
            )
        ).all()
        if len(bg_decoys) < 20:
            errors.append(
                f"background_noise has {len(bg_decoys)} artifacts; need ≥ 20 decoys "
                "(storyline-agnostic mailbox noise: billing, newsletters, cold outreach, system reminders)"
            )
        # Cross-storyline noise: count noise events with effects across ≥ 2 distinct storylines
        cross = 0
        all_effects = session.exec(select(NoiseEffect)).all()
        all_moments = {m.moment_id: m.storyline_id for m in session.exec(select(DeclaredMoment)).all()}
        effects_by_noise: dict[str, set[str]] = {}
        for e in all_effects:
            sid = all_moments.get(e.target_moment_id)
            if sid is None:
                continue
            effects_by_noise.setdefault(e.noise_id, set()).add(sid)
        for noise_id, sids in effects_by_noise.items():
            if len(sids) >= 2:
                cross += 1
        if cross < 2:
            errors.append(
                f"cross-storyline noise events: have {cross}, want ≥ 2 "
                "(noise events whose effects span ≥ 2 distinct storyline_ids — the convergence layer)"
            )
    return (not errors, errors)


def _phase_c_already_done(slug: str) -> bool:
    """Phase C is done if background_noise has ≥20 decoy artifacts AND ≥2 noise
    events whose effects span ≥2 storylines (the cross-storyline coordination)."""
    bg_arc = persona_dir(slug) / "internal" / "storylines" / BACKGROUND_STORYLINE_ID / "arc.md"
    if not bg_arc.exists():
        return False
    with Session(engine_for(slug)) as session:
        bg_decoys = session.exec(
            select(PlannedArtifact).where(
                PlannedArtifact.storyline_id == BACKGROUND_STORYLINE_ID
            )
        ).all()
        if len(bg_decoys) < 20:
            return False
        all_effects = session.exec(select(NoiseEffect)).all()
        moment_to_storyline = {
            m.moment_id: m.storyline_id
            for m in session.exec(select(DeclaredMoment)).all()
        }
    effects_by_noise: dict[str, set[str]] = {}
    for e in all_effects:
        sid = moment_to_storyline.get(e.target_moment_id)
        if sid:
            effects_by_noise.setdefault(e.noise_id, set()).add(sid)
    cross = sum(1 for sids in effects_by_noise.values() if len(sids) >= 2)
    return cross >= 2


def stage_05_is_complete(slug: str) -> bool:
    """True only if Phase A + every Phase B + Phase C are all done. Used by the
    graph-level idempotency check to avoid short-circuiting on PARTIAL Stage 5
    output. Counts alone (storylines + moments) aren't enough — a kill mid-
    Phase-B can leave several detail storylines empty and Phase C unauthored."""
    if not _phase_a_already_done(slug):
        return False
    with Session(engine_for(slug)) as session:
        storylines = list(session.exec(select(Storyline)).all())
    for s in storylines:
        if s.storyline_id == BACKGROUND_STORYLINE_ID:
            continue
        if not _phase_b_already_done(slug, s.storyline_id):
            return False
    if not _phase_c_already_done(slug):
        return False
    return True


def _run_phase_c(slug: str) -> tuple[bool, list[str]]:
    if _phase_c_already_done(slug):
        return (True, [])
    system_prompt, user_template = load_stage_prompt("stage_05c_cross_storyline")
    vars_ = {**default_render_vars(slug), "declared_moments_dump": _moments_dump(slug)}
    system_prompt = render(system_prompt, **vars_)
    user_prompt = render(user_template, **vars_)

    tools = [
        build_declare_noise_event(slug=slug),
        build_declare_planned_artifact(slug=slug),
    ]

    result = run_agent(
        stage_id=f"{STAGE_ID}_phase_c",
        slug=slug,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        structured_tools=tools,
        allowed_file_tools=["Read", "Write", "Edit", "Glob"],
        verifier=_phase_c_verifier,
    )
    return (result.success, result.missing_outputs if not result.success else [])


# ---------------------------------------------------------------------------
# Final referential-integrity sweep + global verifier (same shape as before)
# ---------------------------------------------------------------------------


def _ri_violations(slug: str) -> list[str]:
    violations: list[str] = []
    with Session(engine_for(slug)) as session:
        planned_ids = set(session.exec(select(PlannedArtifact.artifact_id)).all())
        storyline_ids = set(session.exec(select(Storyline.storyline_id)).all())

        for msa in session.exec(select(MomentSupportingArtifact)).all():
            if msa.artifact_id not in planned_ids:
                violations.append(
                    f"declared_moment '{msa.moment_id}' references unknown "
                    f"supporting_artifact_id '{msa.artifact_id}'"
                )

        moments_by_storyline: dict[str, int] = {}
        for m in session.exec(select(DeclaredMoment)).all():
            moments_by_storyline[m.storyline_id] = moments_by_storyline.get(m.storyline_id, 0) + 1
        for sid in storyline_ids:
            if sid == BACKGROUND_STORYLINE_ID:
                continue  # decoys-only; no moments expected
            if moments_by_storyline.get(sid, 0) == 0:
                violations.append(
                    f"storyline '{sid}' has zero declared_moments; every non-background storyline should produce ≥ 1"
                )
    return violations


def _final_verifier(slug: str) -> tuple[bool, list[str]]:
    errors: list[str] = []
    with Session(engine_for(slug)) as session:
        storylines = session.exec(select(Storyline)).all()
        if len(storylines) < MIN_STORYLINES:
            errors.append(f"storylines: have {len(storylines)}, want ≥ {MIN_STORYLINES}")

        moments = session.exec(select(DeclaredMoment)).all()
        if len(moments) < MIN_MOMENTS:
            errors.append(f"declared_moments: have {len(moments)}, want ≥ {MIN_MOMENTS}")

        noise = session.exec(select(NoiseEvent)).all()
        if len(noise) < MIN_NOISE_EVENTS:
            errors.append(
                f"noise_events: have {len(noise)}, want ≥ {MIN_NOISE_EVENTS}"
            )

        arc_paths = [s.arc_path for s in storylines]
        if len(set(arc_paths)) != len(arc_paths):
            errors.append("storylines share arc_path values: each must have its own arc.md")

        for s in storylines:
            expected = f"internal/storylines/{s.storyline_id}/arc.md"
            if s.arc_path != expected:
                errors.append(
                    f"storyline '{s.storyline_id}' arc_path is '{s.arc_path}', expected '{expected}'"
                )

    for s in storylines:
        ok, miss = verify_file_exists(slug, s.arc_path)
        if not ok:
            errors.extend(miss)

    errors.extend(_ri_violations(slug))
    return (not errors, errors)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def run_stage_05(*, slug: str) -> dict[str, Any]:
    """Three-phase Stage 5: A (index) → for-each-storyline B → C (cross-storyline)."""
    ensure_persona_spec_visible(slug)

    # Phase A
    ok, errs = _run_phase_a(slug)
    if not ok:
        return _fail("phase_a", errs)

    # Discover the storylines Phase A created (excluding background_noise — Phase C owns that)
    with Session(engine_for(slug)) as session:
        storylines = session.exec(select(Storyline)).all()
    detail_storylines = [s for s in storylines if s.storyline_id != BACKGROUND_STORYLINE_ID]

    # Phase B — sequential per-storyline
    for s in detail_storylines:
        ok, errs = _run_phase_b_one(
            slug,
            storyline_id=s.storyline_id,
            storyline_display_name=s.display_name,
        )
        if not ok:
            return _fail(f"phase_b__{s.storyline_id}", errs)

    # Phase C
    ok, errs = _run_phase_c(slug)
    if not ok:
        return _fail("phase_c", errs)

    # Final sweep
    ok, errs = _final_verifier(slug)
    if not ok:
        return _fail("final_verifier", errs)

    return _ok_update()


def _fail(phase: str, errs: list[str]) -> dict[str, Any]:
    return {
        "errors": [
            {
                "stage": f"{STAGE_ID}_{phase}",
                "message": "verifier failed: " + " | ".join(errs[:10]),
                "retry_count": 0,
            }
        ]
    }


def _ok_update() -> dict[str, Any]:
    return {
        "completed_stages": [STAGE_ID],
        "stage_outputs": {
            STAGE_ID: [
                "internal/storylines_index.md",
                "internal/storylines/*/arc.md",
                "storylines table",
                "declared_moments table",
                "noise_events table (incl. cross-storyline)",
                "planned_artifacts table (incl. background_noise decoys)",
            ]
        },
    }
