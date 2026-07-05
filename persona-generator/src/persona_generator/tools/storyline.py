"""Stage 5 structured tools.

Four tools, all idempotent on their primary key (re-running Stage 5 with
the same IDs overwrites in place):

  - add_storyline                INSERT storylines
  - declare_digest_moment        INSERT declared_moments + N moment_supporting_artifacts
  - declare_noise_event          INSERT noise_events + N noise_effects
  - declare_planned_artifact     INSERT planned_artifacts

Each tool returns {ok: True, ...} on success; pydantic-style validation errors
are surfaced as isError responses so the agent can self-correct.

Cross-call referential integrity (a `supporting_artifact_id` exists in
planned_artifacts, a `target_moment_id` exists in declared_moments) is NOT
enforced here — that's a post-stage verifier sweep with retry-on-violation.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from claude_agent_sdk import tool
from sqlmodel import Session, delete

from ..db import engine_for
from ..models import (
    DeclaredMoment,
    MomentSupportingArtifact,
    NoiseEffect,
    NoiseEvent,
    PlannedArtifact,
    Storyline,
)

VALID_SECTIONS = {
    "if_one_thing",
    "urgent_todo",
    "decisions_approvals",
    "ai_news",
    "team_pulse",
    "calendar_personal",
}
VALID_PRIORITIES = {"P0", "P1", "P2"}
VALID_ACTION_CLASSES = {
    "dispatch_immediate",
    "reply_short",
    "decide",
    "approve",
    "track",
    "fyi",
}
VALID_EFFECT_KINDS = {"SHIFTED", "CANCELED", "MODIFIED", "DECLARED"}
VALID_ARTIFACT_KINDS = {"email", "note", "calendar_invite", "calendar_update"}


def _ok(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps({"ok": True, **payload})}]}


def _err(msg: str) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps({"ok": False, "error": msg})}],
        "isError": True,
    }


def build_add_storyline(*, slug: str):
    @tool(
        "add_storyline",
        "Register a storyline. Call once per storyline before authoring its moments / "
        "noise events / planned artifacts. arc_path is where the prose narrative arc "
        "for this storyline will live (e.g. internal/storylines/series_a_raise/arc.md).",
        {
            "storyline_id": Annotated[str, "Stable lowercase id, e.g. 'series_a_raise'."],
            "display_name": Annotated[str, "Human-readable name, e.g. 'Series A raise — Veridian vs. Northbrook'."],
            "arc_path": Annotated[str, "Relative path to the arc.md, e.g. 'internal/storylines/series_a_raise/arc.md'."],
        },
    )
    async def add_storyline(args: dict[str, Any]) -> dict[str, Any]:
        sid = args["storyline_id"]
        with Session(engine_for(slug)) as session:
            existing = session.get(Storyline, sid)
            if existing is None:
                session.add(
                    Storyline(
                        storyline_id=sid,
                        display_name=args["display_name"],
                        arc_path=args["arc_path"],
                    )
                )
            else:
                existing.display_name = args["display_name"]
                existing.arc_path = args["arc_path"]
                session.add(existing)
            session.commit()
        return _ok({"storyline_id": sid})

    return add_storyline


def build_declare_digest_moment(*, slug: str):
    @tool(
        "declare_digest_moment",
        "Declare a digest moment that should surface on a specific morning. Inserts "
        "one row into declared_moments and N rows into moment_supporting_artifacts "
        "linking it to the artifacts that support it. supporting_artifact_ids must "
        "list planned_artifact IDs declared via declare_planned_artifact (the "
        "post-stage verifier will catch dangling references and retry).",
        {
            "moment_id": Annotated[str, "Stable lowercase id, e.g. 'series_a_raise.moment_marcus_ic_dayof'."],
            "storyline_id": Annotated[str, "Owning storyline (must exist via add_storyline)."],
            "target_morning": Annotated[str, "ISO date YYYY-MM-DD. Must fall in Days 6–35 (2026-04-24 to 2026-05-23) to surface; outside that window the moment will be filtered at Stage 9b."],
            "section": Annotated[str, "One of: if_one_thing | urgent_todo | decisions_approvals | ai_news | team_pulse | calendar_personal."],
            "priority": Annotated[str, "P0 | P1 | P2."],
            "action_class": Annotated[str, "dispatch_immediate | reply_short | decide | approve | track | fyi."],
            "rationale": Annotated[str, "One- or two-sentence rationale that will appear in the morning's digest."],
            "supporting_artifact_ids": Annotated[list[str], "IDs of planned artifacts that support this moment (must be declared via declare_planned_artifact)."],
        },
    )
    async def declare_digest_moment(args: dict[str, Any]) -> dict[str, Any]:
        if args["section"] not in VALID_SECTIONS:
            return _err(f"section must be one of {sorted(VALID_SECTIONS)}, got '{args['section']}'")
        if args["priority"] not in VALID_PRIORITIES:
            return _err(f"priority must be one of {sorted(VALID_PRIORITIES)}, got '{args['priority']}'")
        if args["action_class"] not in VALID_ACTION_CLASSES:
            return _err(f"action_class must be one of {sorted(VALID_ACTION_CLASSES)}, got '{args['action_class']}'")

        mid = args["moment_id"]
        sids = args.get("supporting_artifact_ids", []) or []

        with Session(engine_for(slug)) as session:
            # Make sure the storyline exists (FK sanity check; non-fatal — we'll let RI sweep handle)
            if session.get(Storyline, args["storyline_id"]) is None:
                return _err(f"storyline_id '{args['storyline_id']}' not found. Call add_storyline first.")

            existing = session.get(DeclaredMoment, mid)
            if existing is None:
                session.add(
                    DeclaredMoment(
                        moment_id=mid,
                        storyline_id=args["storyline_id"],
                        target_morning=args["target_morning"],
                        section=args["section"],
                        priority=args["priority"],
                        action_class=args["action_class"],
                        rationale=args["rationale"],
                        initial_lifecycle="DECLARED",
                    )
                )
            else:
                existing.storyline_id = args["storyline_id"]
                existing.target_morning = args["target_morning"]
                existing.section = args["section"]
                existing.priority = args["priority"]
                existing.action_class = args["action_class"]
                existing.rationale = args["rationale"]
                session.add(existing)

            # Replace supporting-artifacts links wholesale
            session.exec(delete(MomentSupportingArtifact).where(MomentSupportingArtifact.moment_id == mid))
            for aid in sids:
                session.add(MomentSupportingArtifact(moment_id=mid, artifact_id=aid))

            session.commit()
        return _ok({"moment_id": mid, "supporting_count": len(sids)})

    return declare_digest_moment


def build_declare_noise_event(*, slug: str):
    @tool(
        "declare_noise_event",
        "Declare a plot-level disruption (a reschedule, cancellation, surprise) plus "
        "its effects on already-declared moments. Inserts one row in noise_events and "
        "one row in noise_effects per item in effects[]. Each effect must reference an "
        "existing declared_moment via target_moment_id; the post-stage verifier will "
        "catch dangling references.",
        {
            "noise_id": Annotated[str, "Stable lowercase id, e.g. 'noise_marcus_ic_pushed'."],
            "storyline_id": Annotated[str, "Owning storyline (must exist via add_storyline)."],
            "occurrence_date": Annotated[str, "ISO date YYYY-MM-DD when the noise event happens in the persona's world."],
            "triggers_artifact_id": Annotated[str | None, "The artifact this noise produces (e.g. reschedule email). May be null for silent noise."],
            "effects": Annotated[
                list[dict],
                "Each effect: {target_moment_id, effect_kind (SHIFTED|CANCELED|MODIFIED|DECLARED), effective_from (ISO date), new_target_morning?, new_rationale?, new_priority?}.",
            ],
        },
    )
    async def declare_noise_event(args: dict[str, Any]) -> dict[str, Any]:
        nid = args["noise_id"]
        effects = args.get("effects", []) or []

        # Validate effect kinds up front so the agent gets one error not N.
        for e in effects:
            if e.get("effect_kind") not in VALID_EFFECT_KINDS:
                return _err(
                    f"effect.effect_kind must be one of {sorted(VALID_EFFECT_KINDS)}, "
                    f"got '{e.get('effect_kind')}' for target_moment_id={e.get('target_moment_id')}"
                )

        with Session(engine_for(slug)) as session:
            if session.get(Storyline, args["storyline_id"]) is None:
                return _err(f"storyline_id '{args['storyline_id']}' not found. Call add_storyline first.")

            # Pre-check: every target_moment_id must already exist (FK would otherwise fire).
            unknown_moments = [
                e["target_moment_id"]
                for e in effects
                if session.get(DeclaredMoment, e["target_moment_id"]) is None
            ]
            if unknown_moments:
                return _err(
                    f"noise_effect target_moment_id(s) not found: {sorted(set(unknown_moments))}. "
                    f"Call declare_digest_moment for each before declaring the noise event."
                )

            existing = session.get(NoiseEvent, nid)
            if existing is None:
                session.add(
                    NoiseEvent(
                        noise_id=nid,
                        storyline_id=args["storyline_id"],
                        occurrence_date=args["occurrence_date"],
                        triggers_artifact_id=args.get("triggers_artifact_id"),
                    )
                )
            else:
                existing.storyline_id = args["storyline_id"]
                existing.occurrence_date = args["occurrence_date"]
                existing.triggers_artifact_id = args.get("triggers_artifact_id")
                session.add(existing)

            # Wholesale replace this noise event's effects
            session.exec(delete(NoiseEffect).where(NoiseEffect.noise_id == nid))
            for e in effects:
                session.add(
                    NoiseEffect(
                        noise_id=nid,
                        target_moment_id=e["target_moment_id"],
                        effect_kind=e["effect_kind"],
                        effective_from=e["effective_from"],
                        new_target_morning=e.get("new_target_morning"),
                        new_rationale=e.get("new_rationale"),
                        new_priority=e.get("new_priority"),
                    )
                )
            session.commit()
        return _ok({"noise_id": nid, "effect_count": len(effects)})

    return declare_noise_event


def build_declare_planned_artifact(*, slug: str):
    @tool(
        "declare_planned_artifact",
        "Declare an artifact (email, note, calendar invite/update) that this "
        "storyline will produce. Stage 7 will later render the actual prose body; "
        "here we register that it exists and pin its fake timestamp. The digest "
        "agent treats target_render_iso as the artifact's real arrival/creation "
        "time when filtering 'past' vs 'future' relative to a given morning.",
        {
            "artifact_id": Annotated[str, "Stable lowercase id, e.g. 'd10_email_marcus_ic_agenda'."],
            "storyline_id": Annotated[str, "Owning storyline (must exist via add_storyline)."],
            "target_render_date": Annotated[str, "ISO date YYYY-MM-DD when Stage 7 should render this artifact."],
            "target_render_iso": Annotated[str | None, "Optional full ISO 8601 timestamp with TZ offset (e.g. '2026-04-24T07:42:00-07:00'). The persona's fake clock — the digest agent treats this as the artifact's real arrival/creation time. If omitted, the orchestrator backfills with a deterministic per-kind plausible minute before Stage 7 renders."],
            "kind": Annotated[str, "One of: email | note | calendar_invite | calendar_update."],
            "content_sketch": Annotated[str | None, "Optional one- or two-sentence sketch of the content."],
            "is_decoy": Annotated[bool, "True if this artifact is a deliberate decoy (eval will expect suppression)."],
        },
    )
    async def declare_planned_artifact(args: dict[str, Any]) -> dict[str, Any]:
        if args["kind"] not in VALID_ARTIFACT_KINDS:
            return _err(f"kind must be one of {sorted(VALID_ARTIFACT_KINDS)}, got '{args['kind']}'")

        # Validate target_render_iso if provided
        target_iso = args.get("target_render_iso")
        if target_iso is not None and target_iso != "":
            # Light format check; full validation lives in the backfill helper
            if "T" not in target_iso or len(target_iso) < 19:
                return _err(
                    f"target_render_iso must be ISO 8601 with TZ offset like "
                    f"'2026-04-24T07:42:00-07:00', got '{target_iso}'"
                )
        else:
            target_iso = None

        aid = args["artifact_id"]
        with Session(engine_for(slug)) as session:
            if session.get(Storyline, args["storyline_id"]) is None:
                return _err(f"storyline_id '{args['storyline_id']}' not found. Call add_storyline first.")

            existing = session.get(PlannedArtifact, aid)
            if existing is None:
                session.add(
                    PlannedArtifact(
                        artifact_id=aid,
                        storyline_id=args["storyline_id"],
                        target_render_date=args["target_render_date"],
                        target_render_iso=target_iso,
                        kind=args["kind"],
                        content_sketch=args.get("content_sketch"),
                        is_decoy=1 if args.get("is_decoy") else 0,
                    )
                )
            else:
                existing.storyline_id = args["storyline_id"]
                existing.target_render_date = args["target_render_date"]
                if target_iso is not None:
                    existing.target_render_iso = target_iso
                existing.kind = args["kind"]
                existing.content_sketch = args.get("content_sketch")
                existing.is_decoy = 1 if args.get("is_decoy") else 0
                session.add(existing)
            session.commit()
        return _ok({"artifact_id": aid})

    return declare_planned_artifact
