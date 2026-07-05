"""Stage 7 / 8 structured tool: ``emit_email_attachment``.

Attaches one file to an already-emitted email. Synthetic content — the LLM
passes text content (a CSV body, a markdown memo, a plain-text dump) which we
encode to UTF-8 bytes and store as a BLOB. The mime_type is what consumers
(the service emulator, eventually the digest agent) see when listing
attachments.

The tool is idempotent on ``attachment_id`` — re-emitting overwrites in place.

Binary attachments (real PDFs, PNGs, XLSX) are deliberately out of scope for
the LLM: the generator can't produce structured binary content directly.
Consumers that need real PDFs can generate them from the text/markdown
content downstream (e.g., the service emulator renders board-memo markdown
to PDF on the fly).
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from claude_agent_sdk import tool
from sqlmodel import Session, select

from ..db import engine_for
from ..models import Email, EmailAttachment

# Allowed MIME types for LLM-emitted attachments. Restricted to text formats —
# the LLM can write CSV, markdown, plaintext, and JSON; it can't write real
# binary PDFs/images. Downstream renderers can convert these to PDF if needed.
VALID_MIME_TYPES = {
    "text/plain",
    "text/csv",
    "text/markdown",
    "text/html",
    "application/json",
}


def build_emit_email_attachment(*, slug: str):
    @tool(
        "emit_email_attachment",
        "Attach one file to an email already emitted via emit_email. Identify the "
        "target email by its artifact_id (the same one passed to emit_email) — the "
        "tool resolves it to the email's server-minted message_id internally. The "
        "content is text in one of the allowed MIME types (plain, csv, markdown, "
        "html, json). The LLM cannot directly produce binary PDFs/images; if a "
        "downstream consumer needs a PDF rendering, the markdown body here is the "
        "source.",
        {
            "attachment_id": Annotated[str, "Stable id, e.g. 'd14_attach_q1_metrics_csv'."],
            "email_artifact_id": Annotated[str, "The Email.artifact_id of the email to attach to (passed to a prior emit_email call). The tool resolves this to the email's message_id."],
            "filename": Annotated[str, "Display filename including extension, e.g. 'q1_metrics.csv', 'board_memo.md', 'pipeline.json'."],
            "mime_type": Annotated[str, "One of: text/plain | text/csv | text/markdown | text/html | application/json."],
            "content_text": Annotated[str, "Full text body of the attachment. Stored UTF-8 encoded in the BLOB column."],
        },
    )
    async def emit_email_attachment(args: dict[str, Any]) -> dict[str, Any]:
        if args["mime_type"] not in VALID_MIME_TYPES:
            return _err(
                f"mime_type must be one of {sorted(VALID_MIME_TYPES)}, got '{args['mime_type']}'"
            )

        aid = args["attachment_id"]
        email_aid = args["email_artifact_id"]
        content_bytes = args["content_text"].encode("utf-8")

        with Session(engine_for(slug)) as session:
            email = session.exec(
                select(Email).where(Email.artifact_id == email_aid)
            ).first()
            if email is None:
                return _err(
                    f"email_artifact_id '{email_aid}' not found among emitted emails. "
                    "Call emit_email first."
                )
            mid = email.message_id
            existing = session.get(EmailAttachment, aid)
            if existing is None:
                session.add(
                    EmailAttachment(
                        attachment_id=aid,
                        message_id=mid,
                        filename=args["filename"],
                        mime_type=args["mime_type"],
                        content=content_bytes,
                    )
                )
            else:
                existing.message_id = mid
                existing.filename = args["filename"]
                existing.mime_type = args["mime_type"]
                existing.content = content_bytes
                session.add(existing)
            session.commit()
        return _ok({"attachment_id": aid, "bytes": len(content_bytes)})

    return emit_email_attachment


def _ok(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps({"ok": True, **payload})}]}


def _err(msg: str) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps({"ok": False, "error": msg})}],
        "isError": True,
    }
