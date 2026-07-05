"""Stage 7 / 8 structured tools: ``emit_email``, ``write_note``, ``add_calendar_op``.

Each tool INSERTs one row into the corresponding table. The artifact_id pins
the row back to the Stage-5 planned_artifacts declaration. The X-Synth-*
columns let eval read storyline/tonal_zone without parsing prose.

All three tools are idempotent on their primary key — the day-agent may be
retried and re-emit the same row. The tools update-in-place if the key exists.
"""

from __future__ import annotations

import hashlib
import json
from typing import Annotated, Any

from claude_agent_sdk import tool
from sqlmodel import Session, select

from ..db import engine_for
from ..models import CalendarOp, Email, EmailThread, Note, PlannedArtifact


def mint_message_id(artifact_id: str, from_addr: str) -> str:
    """Deterministic, opaque RFC-822-style message id.

    Hash seed is `f"{artifact_id}|{from_addr}"` — including the sender is
    necessary because the same planned_artifact can legitimately produce
    multiple emails when it represents a back-and-forth (e.g., a calendar
    update where both parties exchange messages). Hashing artifact_id alone
    collapses such pairs to one id; pairing with the sender keeps them
    distinct.

    Suffixed with the sender's domain to preserve RFC-822 shape
    (`<id@domain>`). Real Gmail message-ids are opaque — by matching that,
    we close off the LLM hallucination path where the agent constructs
    message-ids from descriptive context (the persona-generator's old
    `<dN-handle-topic@domain>` scheme was human-readable enough that
    downstream agents could plausibly guess valid-looking IDs).

    Deterministic on `(artifact_id, from_addr)` so re-emissions are
    idempotent and the sibling persona.db migration script produces
    matching IDs.
    """
    if "@" in from_addr:
        domain = from_addr.split("@", 1)[1].strip().strip(">").strip()
    else:
        domain = "persona.test"
    seed = f"{artifact_id}|{from_addr}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:14]
    return f"<{digest}@{domain}>"

VALID_TONAL_ZONES = {
    "public_front_stage",
    "professional_front_stage",
    "internal_mid_stage",
    "private_back_stage",
}
VALID_CALENDAR_OPS = {
    "add_event",
    "move_event",
    "cancel_event",
    "accept_invite",
    "decline_invite",
    "tentative_invite",
    "update_event",
}
VALID_CALENDAR_SOURCES = {"direct", "email"}


def _ok(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps({"ok": True, **payload})}]}


def _err(msg: str) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps({"ok": False, "error": msg})}],
        "isError": True,
    }


def build_emit_email(*, slug: str):
    @tool(
        "emit_email",
        "Render and INSERT one email row. Use for every planned_artifact with kind='email' "
        "rendered today. The tool mints an opaque RFC-822 message_id server-side from "
        "artifact_id (you do not supply or guess one). If this is a reply, pass "
        "in_reply_to_artifact_id — the tool resolves it to the parent's message_id. "
        "artifact_id MUST reference a row in planned_artifacts. body is the rendered "
        "prose in the persona's voice and the right tonal zone for the recipient.",
        {
            "artifact_id": Annotated[str, "FK to planned_artifacts.artifact_id. Also the seed for the minted message_id."],
            "thread_id": Annotated[str | None, "Optional thread id; if a reply to a prior email."],
            "from_addr": Annotated[str, "RFC 822 From, e.g. 'avery@plumb.so'. Used as the domain in the minted message_id."],
            "to_addrs_json": Annotated[str, "JSON array of To addresses, e.g. '[\"mary@bessemer.com\"]'."],
            "cc_addrs_json": Annotated[str | None, "JSON array of CC addresses; null if none."],
            "subject": Annotated[str, "Email subject."],
            "date_iso": Annotated[str, "Send timestamp ISO 8601 with TZ offset."],
            "in_reply_to_artifact_id": Annotated[str | None, "Parent email's artifact_id if this is a reply; the tool resolves it to the parent's message_id. Null for thread-root emails."],
            "body": Annotated[str, "Rendered prose body (plain text or markdown)."],
            "x_synth_storyline": Annotated[str | None, "FK to storylines.storyline_id."],
            "x_synth_moment_id": Annotated[str | None, "FK to declared_moments.moment_id if this email is a moment's supporting artifact."],
            "x_synth_tonal_zone": Annotated[str, "One of: public_front_stage | professional_front_stage | internal_mid_stage | private_back_stage."],
            "x_synth_decoy": Annotated[bool, "True if this is decoy noise (mirror is_decoy from planned_artifacts)."],
            "x_synth_source_plan": Annotated[str | None, "Free-text pointer back to the declaring storyline/arc."],
        },
    )
    async def emit_email(args: dict[str, Any]) -> dict[str, Any]:
        if args["x_synth_tonal_zone"] not in VALID_TONAL_ZONES:
            return _err(
                f"x_synth_tonal_zone must be one of {sorted(VALID_TONAL_ZONES)}, "
                f"got '{args['x_synth_tonal_zone']}'"
            )
        for k in ("to_addrs_json", "cc_addrs_json"):
            v = args.get(k)
            if v is None or v == "":
                continue
            try:
                json.loads(v)
            except (json.JSONDecodeError, TypeError) as exc:
                return _err(f"{k} must be a JSON array string, got: {exc}")

        mid = mint_message_id(args["artifact_id"], args["from_addr"])
        with Session(engine_for(slug)) as session:
            if session.get(PlannedArtifact, args["artifact_id"]) is None:
                return _err(
                    f"artifact_id '{args['artifact_id']}' not found in planned_artifacts. "
                    "Stage 7 may only render artifacts pre-declared by Stage 5."
                )

            # Resolve in_reply_to_artifact_id → parent message_id (so the LLM
            # never has to know, construct, or carry message_ids).
            parent_mid: str | None = None
            parent_aid = args.get("in_reply_to_artifact_id")
            if parent_aid:
                parent = session.exec(
                    select(Email).where(Email.artifact_id == parent_aid)
                ).first()
                if parent is None:
                    return _err(
                        f"in_reply_to_artifact_id '{parent_aid}' not found among emitted emails. "
                        "Emit the parent email first."
                    )
                parent_mid = parent.message_id

            existing = session.get(Email, mid)
            row = existing or Email(message_id=mid, from_addr="", to_addrs_json="", subject="", date_iso="", body="")
            row.message_id = mid
            row.artifact_id = args["artifact_id"]
            row.thread_id = args.get("thread_id")
            row.from_addr = args["from_addr"]
            row.to_addrs_json = args["to_addrs_json"]
            row.cc_addrs_json = args.get("cc_addrs_json")
            row.subject = args["subject"]
            row.date_iso = args["date_iso"]
            row.in_reply_to = parent_mid
            row.body = args["body"]
            row.x_synth_storyline = args.get("x_synth_storyline")
            row.x_synth_moment_id = args.get("x_synth_moment_id")
            row.x_synth_tonal_zone = args["x_synth_tonal_zone"]
            row.x_synth_decoy = 1 if args.get("x_synth_decoy") else 0
            row.x_synth_source_plan = args.get("x_synth_source_plan")
            session.add(row)

            # Materialize thread row if this is a thread root
            tid = args.get("thread_id")
            if tid and parent_mid is None:
                thread = session.get(EmailThread, tid)
                if thread is None:
                    session.add(EmailThread(thread_id=tid, root_message_id=mid, subject=args["subject"]))

            session.commit()
        return _ok({"message_id": mid})

    return emit_email


def build_write_note(*, slug: str):
    @tool(
        "write_note",
        "Render and INSERT one note row. Use for every planned_artifact with kind='note' "
        "rendered today. note_id stable per artifact. filename is what the notes-app would "
        "show (e.g. '2026-05-14 board prep.md'). body is the rendered prose in the "
        "appropriate tonal zone.",
        {
            "note_id": Annotated[str, "Stable id, e.g. 'note_d20_board_prep_2026_05_14'."],
            "artifact_id": Annotated[str, "FK to planned_artifacts.artifact_id."],
            "filename": Annotated[str, "Display filename, e.g. '2026-05-14 board prep.md'."],
            "title": Annotated[str | None, "Note title (often the H1 of body); null OK."],
            "body": Annotated[str, "Rendered prose body."],
            "created_iso": Annotated[str, "Creation timestamp ISO 8601 with TZ."],
            "updated_iso": Annotated[str | None, "Last-updated timestamp; null if same as created."],
            "x_synth_storyline": Annotated[str | None, "FK to storylines.storyline_id."],
            "x_synth_moment_id": Annotated[str | None, "FK to declared_moments.moment_id if this note supports a moment."],
            "x_synth_tonal_zone": Annotated[str, "One of: public_front_stage | professional_front_stage | internal_mid_stage | private_back_stage."],
            "x_synth_source_plan": Annotated[str | None, "Free-text pointer back to the declaring storyline."],
        },
    )
    async def write_note(args: dict[str, Any]) -> dict[str, Any]:
        if args["x_synth_tonal_zone"] not in VALID_TONAL_ZONES:
            return _err(
                f"x_synth_tonal_zone must be one of {sorted(VALID_TONAL_ZONES)}, "
                f"got '{args['x_synth_tonal_zone']}'"
            )
        nid = args["note_id"]
        with Session(engine_for(slug)) as session:
            if session.get(PlannedArtifact, args["artifact_id"]) is None:
                return _err(
                    f"artifact_id '{args['artifact_id']}' not found in planned_artifacts."
                )
            existing = session.get(Note, nid)
            row = existing or Note(note_id=nid, filename=args["filename"], body=args["body"], created_iso=args["created_iso"])
            row.note_id = nid
            row.artifact_id = args["artifact_id"]
            row.filename = args["filename"]
            row.title = args.get("title")
            row.body = args["body"]
            row.created_iso = args["created_iso"]
            row.updated_iso = args.get("updated_iso")
            row.x_synth_storyline = args.get("x_synth_storyline")
            row.x_synth_moment_id = args.get("x_synth_moment_id")
            row.x_synth_tonal_zone = args["x_synth_tonal_zone"]
            row.x_synth_source_plan = args.get("x_synth_source_plan")
            session.add(row)
            session.commit()
        return _ok({"note_id": nid})

    return write_note


def build_add_calendar_op(*, slug: str):
    @tool(
        "add_calendar_op",
        "Append one calendar operation to calendar_ops. Use for every calendar_invite / "
        "calendar_update planned_artifact today, plus any RSVP (accept/decline) the persona "
        "issues today. op is one of: add_event | move_event | cancel_event | accept_invite "
        "| decline_invite | tentative_invite | update_event. payload_json carries the op-specific "
        "fields (new start_iso for move_event, etc.).",
        {
            "ts_iso": Annotated[str, "When the op happened, ISO 8601 with TZ."],
            "op": Annotated[str, "add_event | move_event | cancel_event | accept_invite | decline_invite | tentative_invite | update_event."],
            "event_id": Annotated[str, "Target event id (matches a prior add_event or an initial_calendar_event)."],
            "source": Annotated[str, "'direct' (persona acted) or 'email' (op happened in response to an email)."],
            "linked_message_id": Annotated[str | None, "If source=='email', the originating Email.message_id."],
            "payload_json": Annotated[str, "JSON object string with op-specific fields. For add_event: {title, start_iso, end_iso, attendees, location}. For move_event: {new_start_iso, new_end_iso}. For cancel_event: {reason}. For *_invite: {response}."],
            "artifact_id": Annotated[str | None, "Optional FK to planned_artifacts (when the op IS the planned artifact)."],
        },
    )
    async def add_calendar_op(args: dict[str, Any]) -> dict[str, Any]:
        if args["op"] not in VALID_CALENDAR_OPS:
            return _err(f"op must be one of {sorted(VALID_CALENDAR_OPS)}, got '{args['op']}'")
        if args["source"] not in VALID_CALENDAR_SOURCES:
            return _err(f"source must be one of {sorted(VALID_CALENDAR_SOURCES)}, got '{args['source']}'")
        try:
            payload = json.loads(args["payload_json"])
        except (json.JSONDecodeError, TypeError) as exc:
            return _err(f"payload_json must be a JSON object string, got: {exc}")

        # Canonical-key validation. The day-agent has used short keys like
        # 'start'/'end' in the past, which breaks the calendar replay/emulator.
        # Reject early so the agent corrects on the next call.
        op_kind = args["op"]
        if op_kind == "add_event":
            missing = [k for k in ("title", "start_iso", "end_iso") if k not in payload]
            if missing:
                return _err(
                    f"add_event payload_json must include keys {sorted(missing)}. "
                    "Use canonical ISO 8601 keys with TZ offset: "
                    "{\"title\": \"...\", \"start_iso\": \"2026-04-24T11:00:00-07:00\", "
                    "\"end_iso\": \"2026-04-24T12:00:00-07:00\", \"attendees\": [...], \"location\": \"...\"}. "
                    "Do not use the short keys 'start'/'end'."
                )
        elif op_kind == "move_event":
            missing = [k for k in ("new_start_iso", "new_end_iso") if k not in payload]
            if missing:
                return _err(
                    f"move_event payload_json must include keys {sorted(missing)}. "
                    "Use: {\"new_start_iso\": \"2026-05-14T13:00:00-07:00\", "
                    "\"new_end_iso\": \"2026-05-14T13:30:00-07:00\"}. "
                    "Do not use 'start'/'end' or 'start_iso'/'end_iso' (those are for add_event)."
                )
        elif op_kind == "update_event":
            # update_event accepts any subset; just enforce no short keys.
            for short, canon in (("start", "start_iso"), ("end", "end_iso")):
                if short in payload and canon not in payload:
                    return _err(
                        f"update_event payload uses short key '{short}'; use canonical '{canon}' instead."
                    )

        with Session(engine_for(slug)) as session:
            if args.get("artifact_id") is not None and session.get(PlannedArtifact, args["artifact_id"]) is None:
                return _err(f"artifact_id '{args['artifact_id']}' not found in planned_artifacts.")
            row = CalendarOp(
                ts_iso=args["ts_iso"],
                op=args["op"],
                event_id=args["event_id"],
                source=args["source"],
                linked_message_id=args.get("linked_message_id"),
                payload_json=args["payload_json"],
            )
            session.add(row)
            session.commit()
            op_id = row.op_id
        return _ok({"op_id": op_id, "event_id": args["event_id"]})

    return add_calendar_op
