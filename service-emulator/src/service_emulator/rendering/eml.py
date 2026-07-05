"""Render an ``Email`` row + its attachments as an RFC 822 message.

The persona-generator's ``Email`` row stores the body as plain text + metadata.
The mail-service exposes this as ``.eml`` so a real IMAP client (or our digest
agent) sees a canonical RFC 822 message with optional MIME attachments.
"""

from __future__ import annotations

import base64
import json
from email.message import EmailMessage
from email.utils import format_datetime
from datetime import datetime
from typing import Iterable, Optional

from persona_generator.models import Email, EmailAttachment


def render_email_as_eml(email: Email, attachments: Optional[Iterable[EmailAttachment]] = None) -> str:
    """Return a single string in RFC 822 / EML format.

    - Subject, From, To, Cc, Date, Message-ID, In-Reply-To headers.
    - X-Synth-* headers carry the eval extras (storyline, moment, tonal zone,
      decoy flag, source plan) so a reader inspecting the .eml can see the
      generator's intent without parsing prose.
    - Plain-text body.
    - Attachments encoded as MIME parts; text attachments inline as text/...,
      everything else base64-encoded application/octet-stream.
    """
    msg = EmailMessage()
    msg["Message-ID"] = email.message_id
    msg["From"] = email.from_addr
    if email.to_addrs_json:
        msg["To"] = ", ".join(json.loads(email.to_addrs_json))
    if email.cc_addrs_json:
        msg["Cc"] = ", ".join(json.loads(email.cc_addrs_json))
    msg["Subject"] = email.subject
    msg["Date"] = format_datetime(_parse_iso(email.date_iso))
    if email.in_reply_to:
        msg["In-Reply-To"] = email.in_reply_to
    if email.thread_id:
        msg["X-Synth-Thread-ID"] = email.thread_id
    if email.artifact_id:
        msg["X-Synth-Artifact-ID"] = email.artifact_id
    if email.x_synth_storyline:
        msg["X-Synth-Storyline"] = email.x_synth_storyline
    if email.x_synth_moment_id:
        msg["X-Synth-Moment-ID"] = email.x_synth_moment_id
    if email.x_synth_tonal_zone:
        msg["X-Synth-Tonal-Zone"] = email.x_synth_tonal_zone
    if email.x_synth_decoy:
        msg["X-Synth-Decoy"] = "true"
    if email.x_synth_source_plan:
        msg["X-Synth-Source-Plan"] = email.x_synth_source_plan

    msg.set_content(email.body or "")

    if attachments:
        for att in attachments:
            maintype, _, subtype = att.mime_type.partition("/")
            if maintype == "text":
                msg.add_attachment(
                    att.content.decode("utf-8", errors="replace"),
                    subtype=subtype or "plain",
                    filename=att.filename,
                )
            else:
                msg.add_attachment(
                    att.content,
                    maintype=maintype or "application",
                    subtype=subtype or "octet-stream",
                    filename=att.filename,
                )
    return msg.as_string()


def _parse_iso(s: str) -> datetime:
    """Tolerant ISO 8601 parser. Falls back to naive UTC."""
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return datetime.utcnow()
