"""Mail-service REST routes.

  GET  /mail/messages                       — list (filterable, as_of-aware)
  GET  /mail/messages/{message_id}          — full RFC 822 message (.eml)
  GET  /mail/messages/{message_id}/attachments/{attachment_id}  — attachment bytes
  GET  /mail/threads/{thread_id}            — all messages in a thread
"""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from sqlmodel import Session, select

from persona_generator.db import engine_for
from persona_generator.models import Email, EmailAttachment, EmailThread

from ..clock import parse_as_of
from ..rendering.eml import render_email_as_eml

router = APIRouter()


@router.get("/messages")
def list_messages(
    request: Request,
    as_of: Optional[str] = None,
    from_addr: Optional[str] = None,
    to_addr: Optional[str] = None,
    storyline: Optional[str] = None,
    decoy: Optional[bool] = None,
    limit: int = 100,
):
    """List emails matching filters, with synthetic timestamp ≤ as_of."""
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)

    with Session(engine_for(slug)) as session:
        q = select(Email).where(Email.date_iso <= as_of_iso)
        if from_addr:
            q = q.where(Email.from_addr == from_addr)
        if storyline:
            q = q.where(Email.x_synth_storyline == storyline)
        if decoy is not None:
            q = q.where(Email.x_synth_decoy == (1 if decoy else 0))
        rows = list(session.exec(q.order_by(Email.date_iso.desc()).limit(limit)).all())

    # to_addr is a contains-match on the JSON array; do it in Python
    if to_addr:
        rows = [r for r in rows if r.to_addrs_json and to_addr in (r.to_addrs_json or "")]

    return {
        "as_of": as_of_iso,
        "count": len(rows),
        "messages": [_summarize(e) for e in rows],
    }


@router.get("/messages/{message_id}")
def get_message(message_id: str, request: Request, as_of: Optional[str] = None):
    """Return the RFC 822 / .eml-formatted message (or 404 if not yet sent at as_of)."""
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)

    with Session(engine_for(slug)) as session:
        email = session.get(Email, message_id)
        if email is None or email.date_iso > as_of_iso:
            raise HTTPException(status_code=404, detail=f"message_id '{message_id}' not visible at as_of={as_of_iso}")
        attachments = list(
            session.exec(
                select(EmailAttachment).where(EmailAttachment.message_id == message_id)
            ).all()
        )

    return Response(
        content=render_email_as_eml(email, attachments=attachments),
        media_type="message/rfc822",
    )


@router.get("/messages/{message_id}/attachments/{attachment_id}")
def get_attachment(message_id: str, attachment_id: str, request: Request, as_of: Optional[str] = None):
    """Return the attachment's raw bytes (or 404)."""
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)

    with Session(engine_for(slug)) as session:
        email = session.get(Email, message_id)
        if email is None or email.date_iso > as_of_iso:
            raise HTTPException(status_code=404, detail="parent message not visible at as_of")
        att = session.get(EmailAttachment, attachment_id)
        if att is None or att.message_id != message_id:
            raise HTTPException(status_code=404, detail=f"attachment '{attachment_id}' not found on message")

    return Response(
        content=att.content,
        media_type=att.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{att.filename}"'},
    )


@router.get("/threads/{thread_id}")
def get_thread(thread_id: str, request: Request, as_of: Optional[str] = None):
    """List all messages in a thread, in send order."""
    slug = request.app.state.slug
    as_of_iso = parse_as_of(as_of)

    with Session(engine_for(slug)) as session:
        thread = session.get(EmailThread, thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail=f"thread_id '{thread_id}' not found")
        messages = list(
            session.exec(
                select(Email)
                .where(Email.thread_id == thread_id)
                .where(Email.date_iso <= as_of_iso)
                .order_by(Email.date_iso)
            ).all()
        )

    return {
        "thread_id": thread_id,
        "subject": thread.subject,
        "as_of": as_of_iso,
        "messages": [_summarize(m) for m in messages],
    }


def _summarize(e: Email) -> dict:
    """Compact JSON summary for the list endpoint."""
    try:
        to_list = json.loads(e.to_addrs_json) if e.to_addrs_json else []
    except (ValueError, TypeError):
        to_list = []
    try:
        cc_list = json.loads(e.cc_addrs_json) if e.cc_addrs_json else []
    except (ValueError, TypeError):
        cc_list = []
    return {
        "message_id": e.message_id,
        "from": e.from_addr,
        "to": to_list,
        "cc": cc_list,
        "subject": e.subject,
        "date_iso": e.date_iso,
        "thread_id": e.thread_id,
        "in_reply_to": e.in_reply_to,
        "storyline_id": e.x_synth_storyline,
        "moment_id": e.x_synth_moment_id,
        "tonal_zone": e.x_synth_tonal_zone,
        "is_decoy": bool(e.x_synth_decoy),
        "artifact_id": e.artifact_id,
    }
