"""Stage 7 tools: emit_email, write_note, add_calendar_op.

Validates: required FK to planned_artifacts, closed-list tonal_zone / op,
JSON validation on payload columns, idempotent re-emit on primary key.
"""

import asyncio
import json

from sqlmodel import Session, select

from persona_generator.db import engine_for, init_db
from persona_generator.models import (
    CalendarOp,
    Email,
    EmailThread,
    Note,
    PlannedArtifact,
    Storyline,
)
from persona_generator.tools.artifact_emit import (
    build_add_calendar_op,
    build_emit_email,
    build_write_note,
)


def _call(tool, args: dict) -> dict:
    return asyncio.run(tool.handler(args))


def _seed_artifact(slug: str, *, artifact_id: str, kind: str = "email") -> None:
    """Insert a Storyline + PlannedArtifact so emit_email / write_note can pass FK check."""
    with Session(engine_for(slug)) as session:
        if session.get(Storyline, "s1") is None:
            session.add(Storyline(storyline_id="s1", display_name="S1", arc_path="x"))
            session.commit()
    with Session(engine_for(slug)) as session:
        session.add(
            PlannedArtifact(
                artifact_id=artifact_id,
                storyline_id="s1",
                target_render_date="2026-04-24",
                kind=kind,
                content_sketch="x",
                is_decoy=0,
            )
        )
        session.commit()


def test_emit_email_basic(temp_data_root):
    init_db("test_slug")
    _seed_artifact("test_slug", artifact_id="d10_email_mary_q1")
    tool = build_emit_email(slug="test_slug")
    result = _call(
        tool,
        {
            "artifact_id": "d10_email_mary_q1",
            "thread_id": "thread_mary_diligence",
            "from_addr": "mary@bessemer.com",
            "to_addrs_json": '["avery@plumb.so"]',
            "cc_addrs_json": None,
            "subject": "Q3 retention by cohort",
            "date_iso": "2026-04-24T07:42:00-07:00",
            "in_reply_to_artifact_id": None,
            "body": "Avery — could you slice this two ways?",
            "x_synth_storyline": "series_a_raise_bessemer",
            "x_synth_moment_id": None,
            "x_synth_tonal_zone": "professional_front_stage",
            "x_synth_decoy": False,
            "x_synth_source_plan": "arc.md",
        },
    )
    assert result.get("isError") is not True
    body = json.loads(result["content"][0]["text"])
    # message_id is server-minted: opaque hash + sender domain. It is NOT
    # constructible from descriptive context — the whole point of the change.
    minted_mid = body["message_id"]
    assert minted_mid.startswith("<") and minted_mid.endswith("@bessemer.com>")
    # Hash is sha256("{artifact_id}|{from_addr}")[:14] — verify byte-for-byte stability.
    # (from_addr is included in the seed so back-and-forth on one artifact between
    # different senders produces distinct ids.)
    import hashlib
    seed = b"d10_email_mary_q1|mary@bessemer.com"
    expected_hash = hashlib.sha256(seed).hexdigest()[:14]
    assert minted_mid == f"<{expected_hash}@bessemer.com>"

    with Session(engine_for("test_slug")) as session:
        row = session.get(Email, minted_mid)
        assert row is not None
        assert row.x_synth_tonal_zone == "professional_front_stage"
        # Thread row created since this is the root of a thread
        thread = session.get(EmailThread, "thread_mary_diligence")
        assert thread is not None
        assert thread.root_message_id == minted_mid


def test_emit_email_reply_resolves_parent(temp_data_root):
    init_db("test_slug")
    _seed_artifact("test_slug", artifact_id="d10_email_parent")
    _seed_artifact("test_slug", artifact_id="d10_email_reply")
    tool = build_emit_email(slug="test_slug")
    # Emit parent
    parent_res = _call(
        tool,
        {
            "artifact_id": "d10_email_parent",
            "thread_id": "t1",
            "from_addr": "mary@bessemer.com",
            "to_addrs_json": '["avery@plumb.so"]',
            "cc_addrs_json": None,
            "subject": "ping",
            "date_iso": "2026-04-24T07:42:00-07:00",
            "in_reply_to_artifact_id": None,
            "body": "first",
            "x_synth_storyline": None,
            "x_synth_moment_id": None,
            "x_synth_tonal_zone": "professional_front_stage",
            "x_synth_decoy": False,
            "x_synth_source_plan": None,
        },
    )
    parent_mid = json.loads(parent_res["content"][0]["text"])["message_id"]
    # Emit reply referencing parent by artifact_id
    reply_res = _call(
        tool,
        {
            "artifact_id": "d10_email_reply",
            "thread_id": "t1",
            "from_addr": "avery@plumb.so",
            "to_addrs_json": '["mary@bessemer.com"]',
            "cc_addrs_json": None,
            "subject": "Re: ping",
            "date_iso": "2026-04-24T08:00:00-07:00",
            "in_reply_to_artifact_id": "d10_email_parent",
            "body": "reply",
            "x_synth_storyline": None,
            "x_synth_moment_id": None,
            "x_synth_tonal_zone": "professional_front_stage",
            "x_synth_decoy": False,
            "x_synth_source_plan": None,
        },
    )
    assert reply_res.get("isError") is not True
    reply_mid = json.loads(reply_res["content"][0]["text"])["message_id"]
    with Session(engine_for("test_slug")) as session:
        reply_row = session.get(Email, reply_mid)
        assert reply_row is not None
        # Tool resolved in_reply_to_artifact_id to parent's minted message_id
        assert reply_row.in_reply_to == parent_mid


def test_emit_email_reply_fails_on_unknown_parent(temp_data_root):
    init_db("test_slug")
    _seed_artifact("test_slug", artifact_id="d10_email_reply")
    tool = build_emit_email(slug="test_slug")
    result = _call(
        tool,
        {
            "artifact_id": "d10_email_reply",
            "thread_id": "t1",
            "from_addr": "avery@plumb.so",
            "to_addrs_json": '["x@y"]',
            "cc_addrs_json": None,
            "subject": "Re: ping",
            "date_iso": "2026-04-24T08:00:00-07:00",
            "in_reply_to_artifact_id": "d10_never_emitted",
            "body": "reply",
            "x_synth_storyline": None,
            "x_synth_moment_id": None,
            "x_synth_tonal_zone": "professional_front_stage",
            "x_synth_decoy": False,
            "x_synth_source_plan": None,
        },
    )
    assert result.get("isError") is True


def test_emit_email_rejects_unknown_artifact(temp_data_root):
    init_db("test_slug")
    tool = build_emit_email(slug="test_slug")
    result = _call(
        tool,
        {
            "artifact_id": "never_declared",
            "thread_id": None,
            "from_addr": "a@b",
            "to_addrs_json": "[]",
            "cc_addrs_json": None,
            "subject": "x",
            "date_iso": "2026-04-24T00:00:00-07:00",
            "in_reply_to_artifact_id": None,
            "body": "x",
            "x_synth_storyline": None,
            "x_synth_moment_id": None,
            "x_synth_tonal_zone": "internal_mid_stage",
            "x_synth_decoy": False,
            "x_synth_source_plan": None,
        },
    )
    assert result.get("isError") is True


def test_emit_email_rejects_bad_tonal_zone(temp_data_root):
    init_db("test_slug")
    _seed_artifact("test_slug", artifact_id="d10_x")
    tool = build_emit_email(slug="test_slug")
    result = _call(
        tool,
        {
            "artifact_id": "d10_x",
            "thread_id": None,
            "from_addr": "a@b",
            "to_addrs_json": "[]",
            "cc_addrs_json": None,
            "subject": "x",
            "date_iso": "2026-04-24T00:00:00-07:00",
            "in_reply_to_artifact_id": None,
            "body": "x",
            "x_synth_storyline": None,
            "x_synth_moment_id": None,
            "x_synth_tonal_zone": "NOT_A_ZONE",
            "x_synth_decoy": False,
            "x_synth_source_plan": None,
        },
    )
    assert result.get("isError") is True


def test_write_note_basic(temp_data_root):
    init_db("test_slug")
    _seed_artifact("test_slug", artifact_id="d20_note_board_prep", kind="note")
    tool = build_write_note(slug="test_slug")
    result = _call(
        tool,
        {
            "note_id": "note_d20_board_prep",
            "artifact_id": "d20_note_board_prep",
            "filename": "2026-05-14 board prep.md",
            "title": "Board prep — May 14",
            "body": "Pipeline against burn. Ramp churn cohort slide.",
            "created_iso": "2026-05-13T22:10:00-07:00",
            "updated_iso": None,
            "x_synth_storyline": "board_meeting_may_14",
            "x_synth_moment_id": None,
            "x_synth_tonal_zone": "private_back_stage",
            "x_synth_source_plan": "arc.md",
        },
    )
    assert result.get("isError") is not True
    with Session(engine_for("test_slug")) as session:
        row = session.get(Note, "note_d20_board_prep")
        assert row is not None
        assert row.filename == "2026-05-14 board prep.md"


def test_add_calendar_op_basic(temp_data_root):
    init_db("test_slug")
    tool = build_add_calendar_op(slug="test_slug")
    result = _call(
        tool,
        {
            "ts_iso": "2026-05-14T10:14:00-07:00",
            "op": "move_event",
            "event_id": "wkly_naveen_1on1",
            "source": "direct",
            "linked_message_id": None,
            "payload_json": '{"new_start_iso": "2026-05-14T13:00:00-07:00", "new_end_iso": "2026-05-14T13:30:00-07:00"}',
            "artifact_id": None,
        },
    )
    assert result.get("isError") is not True
    body = json.loads(result["content"][0]["text"])
    assert body["event_id"] == "wkly_naveen_1on1"

    with Session(engine_for("test_slug")) as session:
        rows = session.exec(select(CalendarOp)).all()
        assert len(rows) == 1
        assert rows[0].op == "move_event"


def test_add_calendar_op_rejects_bad_op(temp_data_root):
    init_db("test_slug")
    tool = build_add_calendar_op(slug="test_slug")
    result = _call(
        tool,
        {
            "ts_iso": "2026-05-14T10:14:00-07:00",
            "op": "BURN_CALENDAR",  # invalid
            "event_id": "x",
            "source": "direct",
            "linked_message_id": None,
            "payload_json": "{}",
            "artifact_id": None,
        },
    )
    assert result.get("isError") is True
