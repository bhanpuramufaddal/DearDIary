"""`emit_email_attachment` tool: identifies parent by `email_artifact_id`
(the tool resolves to the email's server-minted message_id), validates mime
type, encodes text content to UTF-8 bytes, idempotent on attachment_id."""

import asyncio
import json

from sqlmodel import Session

from persona_generator.db import engine_for, init_db
from persona_generator.models import Email, EmailAttachment, PlannedArtifact, Storyline
from persona_generator.tools.email_attachment import build_emit_email_attachment


def _call(tool, args: dict) -> dict:
    return asyncio.run(tool.handler(args))


def _seed_email(
    slug: str,
    *,
    artifact_id: str = "d10_email",
    message_id: str = "<m1@x>",
) -> None:
    """Seed a Storyline + PlannedArtifact + Email so the FK chain on Email.artifact_id
    resolves. The attachment tool then looks up the email by ``artifact_id``."""
    with Session(engine_for(slug)) as session:
        if session.get(Storyline, "s1") is None:
            session.add(Storyline(storyline_id="s1", display_name="S1", arc_path="x"))
            session.commit()
    with Session(engine_for(slug)) as session:
        if session.get(PlannedArtifact, artifact_id) is None:
            session.add(
                PlannedArtifact(
                    artifact_id=artifact_id,
                    storyline_id="s1",
                    target_render_date="2026-04-24",
                    kind="email",
                    content_sketch="x",
                    is_decoy=0,
                )
            )
            session.commit()
    with Session(engine_for(slug)) as session:
        session.add(
            Email(
                message_id=message_id,
                artifact_id=artifact_id,
                from_addr="a@b",
                to_addrs_json="[]",
                subject="x",
                date_iso="2026-04-24T00:00:00-07:00",
                body="x",
            )
        )
        session.commit()


def test_attach_csv(temp_data_root):
    init_db("test_slug")
    _seed_email("test_slug", artifact_id="d10_email_mary_q1")
    tool = build_emit_email_attachment(slug="test_slug")
    result = _call(
        tool,
        {
            "attachment_id": "a1",
            "email_artifact_id": "d10_email_mary_q1",
            "filename": "q1_metrics.csv",
            "mime_type": "text/csv",
            "content_text": "month,arr\n2026-01,1100000\n2026-02,1180000\n",
        },
    )
    assert result.get("isError") is not True
    body = json.loads(result["content"][0]["text"])
    assert body["attachment_id"] == "a1"
    assert body["bytes"] > 0

    with Session(engine_for("test_slug")) as session:
        row = session.get(EmailAttachment, "a1")
        assert row is not None
        assert row.filename == "q1_metrics.csv"
        assert row.mime_type == "text/csv"
        assert b"1180000" in row.content
        # Tool resolved email_artifact_id → message_id (the seed email's "<m1@x>").
        assert row.message_id == "<m1@x>"


def test_rejects_unknown_email_artifact_id(temp_data_root):
    init_db("test_slug")
    tool = build_emit_email_attachment(slug="test_slug")
    result = _call(
        tool,
        {
            "attachment_id": "a2",
            "email_artifact_id": "never_emitted",
            "filename": "x.txt",
            "mime_type": "text/plain",
            "content_text": "x",
        },
    )
    assert result.get("isError") is True


def test_rejects_binary_mime(temp_data_root):
    init_db("test_slug")
    _seed_email("test_slug", artifact_id="d10_email")
    tool = build_emit_email_attachment(slug="test_slug")
    result = _call(
        tool,
        {
            "attachment_id": "a3",
            "email_artifact_id": "d10_email",
            "filename": "x.pdf",
            "mime_type": "application/pdf",  # not in the LLM-text set
            "content_text": "x",
        },
    )
    assert result.get("isError") is True


def test_idempotent_overwrite(temp_data_root):
    init_db("test_slug")
    _seed_email("test_slug", artifact_id="d10_email")
    tool = build_emit_email_attachment(slug="test_slug")
    args = {
        "attachment_id": "a4",
        "email_artifact_id": "d10_email",
        "filename": "draft.md",
        "mime_type": "text/markdown",
        "content_text": "# v1",
    }
    _call(tool, args)
    args["content_text"] = "# v2 — revised"
    _call(tool, args)
    with Session(engine_for("test_slug")) as session:
        row = session.get(EmailAttachment, "a4")
        assert row.content == b"# v2 \xe2\x80\x94 revised"
