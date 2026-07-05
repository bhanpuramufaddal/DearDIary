"""MCP server exposing mail / calendar / notes tools for one persona.

Tools:
  mail_search(as_of?, from_addr?, to_addr?, storyline?, decoy?, limit?) → list of message summaries
  mail_get(message_id, as_of?) → full email body + headers
  mail_thread(thread_id, as_of?) → all messages in a thread
  calendar_list(as_of?, include_cancelled?) → events
  calendar_get(event_id, as_of?) → one event
  notes_search(as_of?, storyline?, limit?) → list of notes
  notes_get(note_id, as_of?) → full markdown note

Connected via stdio (the standard MCP transport).
"""

from __future__ import annotations

import json
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool
from sqlmodel import Session, select

from persona_generator.db import engine_for
from persona_generator.models import (
    CalendarOp,
    Email,
    EmailAttachment,
    EmailThread,
    InitialCalendarEvent,
    Note,
)

from ..clock import parse_as_of
from ..rendering.eml import render_email_as_eml
from ..rendering.notes import render_note_as_markdown
from ..rest.calendar import _replay_state


def _mail_summary(e: Email) -> dict:
    try:
        to_list = json.loads(e.to_addrs_json) if e.to_addrs_json else []
    except (ValueError, TypeError):
        to_list = []
    return {
        "message_id": e.message_id,
        "from": e.from_addr,
        "to": to_list,
        "subject": e.subject,
        "date_iso": e.date_iso,
        "thread_id": e.thread_id,
        "storyline_id": e.x_synth_storyline,
        "is_decoy": bool(e.x_synth_decoy),
    }


def _note_summary(n: Note) -> dict:
    return {
        "note_id": n.note_id,
        "filename": n.filename,
        "title": n.title,
        "created_iso": n.created_iso,
        "storyline_id": n.x_synth_storyline,
    }


def build_server(slug: str) -> Server:
    """Build an MCP Server bound to one persona's DB. The transport (stdio,
    sse, etc.) is wired by the caller — typically via ``stdio_server()``."""

    server = Server(f"service-emulator:{slug}")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [
            Tool(
                name="mail_search",
                description="List emails visible at as_of, optionally filtered by from_addr / to_addr / storyline / decoy. Returns compact summaries (subject, from, date_iso, storyline_id, is_decoy, message_id).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "as_of": {"type": "string", "description": "ISO 8601 with TZ offset; emails after this are hidden"},
                        "from_addr": {"type": "string"},
                        "to_addr": {"type": "string"},
                        "storyline": {"type": "string"},
                        "decoy": {"type": "boolean"},
                        "limit": {"type": "integer", "default": 50},
                    },
                },
            ),
            Tool(
                name="mail_get",
                description="Fetch the full RFC 822 .eml-formatted message body + headers for one message_id (if visible at as_of).",
                inputSchema={
                    "type": "object",
                    "required": ["message_id"],
                    "properties": {
                        "message_id": {"type": "string"},
                        "as_of": {"type": "string"},
                    },
                },
            ),
            Tool(
                name="mail_thread",
                description="List all messages in a thread, in send order.",
                inputSchema={
                    "type": "object",
                    "required": ["thread_id"],
                    "properties": {
                        "thread_id": {"type": "string"},
                        "as_of": {"type": "string"},
                    },
                },
            ),
            Tool(
                name="calendar_list",
                description="List calendar events visible at as_of (state computed by replaying initial_calendar_events + calendar_ops up to as_of).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "as_of": {"type": "string"},
                        "include_cancelled": {"type": "boolean", "default": False},
                    },
                },
            ),
            Tool(
                name="calendar_get",
                description="Fetch a single calendar event by event_id.",
                inputSchema={
                    "type": "object",
                    "required": ["event_id"],
                    "properties": {
                        "event_id": {"type": "string"},
                        "as_of": {"type": "string"},
                    },
                },
            ),
            Tool(
                name="notes_search",
                description="List notes visible at as_of, optionally filtered by storyline.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "as_of": {"type": "string"},
                        "storyline": {"type": "string"},
                        "limit": {"type": "integer", "default": 50},
                    },
                },
            ),
            Tool(
                name="notes_get",
                description="Fetch a note as markdown (with frontmatter listing storyline / moment / tonal zone).",
                inputSchema={
                    "type": "object",
                    "required": ["note_id"],
                    "properties": {
                        "note_id": {"type": "string"},
                        "as_of": {"type": "string"},
                    },
                },
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
        as_of_iso = parse_as_of(arguments.get("as_of"))

        if name == "mail_search":
            with Session(engine_for(slug)) as session:
                q = select(Email).where(Email.date_iso <= as_of_iso)
                if arguments.get("from_addr"):
                    q = q.where(Email.from_addr == arguments["from_addr"])
                if arguments.get("storyline"):
                    q = q.where(Email.x_synth_storyline == arguments["storyline"])
                if "decoy" in arguments:
                    q = q.where(Email.x_synth_decoy == (1 if arguments["decoy"] else 0))
                limit = int(arguments.get("limit", 50))
                rows = list(session.exec(q.order_by(Email.date_iso.desc()).limit(limit)).all())
            if to_addr := arguments.get("to_addr"):
                rows = [r for r in rows if r.to_addrs_json and to_addr in r.to_addrs_json]
            payload = {"as_of": as_of_iso, "count": len(rows), "messages": [_mail_summary(r) for r in rows]}
            return [TextContent(type="text", text=json.dumps(payload, indent=2))]

        if name == "mail_get":
            mid = arguments["message_id"]
            with Session(engine_for(slug)) as session:
                email = session.get(Email, mid)
                if email is None or email.date_iso > as_of_iso:
                    return [TextContent(type="text", text=json.dumps({"error": "not visible at as_of", "as_of": as_of_iso}))]
                atts = list(session.exec(select(EmailAttachment).where(EmailAttachment.message_id == mid)).all())
            return [TextContent(type="text", text=render_email_as_eml(email, attachments=atts))]

        if name == "mail_thread":
            tid = arguments["thread_id"]
            with Session(engine_for(slug)) as session:
                thread = session.get(EmailThread, tid)
                if thread is None:
                    return [TextContent(type="text", text=json.dumps({"error": "thread not found"}))]
                msgs = list(session.exec(
                    select(Email)
                    .where(Email.thread_id == tid)
                    .where(Email.date_iso <= as_of_iso)
                    .order_by(Email.date_iso)
                ).all())
            payload = {
                "thread_id": tid,
                "subject": thread.subject,
                "as_of": as_of_iso,
                "messages": [_mail_summary(m) for m in msgs],
            }
            return [TextContent(type="text", text=json.dumps(payload, indent=2))]

        if name == "calendar_list":
            state = _replay_state(slug, as_of_iso)
            include_cancelled = arguments.get("include_cancelled", False)
            events = [ev for ev in state.values() if include_cancelled or ev["status"] != "CANCELLED"]
            events.sort(key=lambda e: e["start_iso"])
            payload = {"as_of": as_of_iso, "count": len(events), "events": events}
            return [TextContent(type="text", text=json.dumps(payload, indent=2))]

        if name == "calendar_get":
            state = _replay_state(slug, as_of_iso)
            ev = state.get(arguments["event_id"])
            if ev is None:
                return [TextContent(type="text", text=json.dumps({"error": "event not visible at as_of"}))]
            return [TextContent(type="text", text=json.dumps(ev, indent=2))]

        if name == "notes_search":
            with Session(engine_for(slug)) as session:
                q = select(Note).where(Note.created_iso <= as_of_iso)
                if arguments.get("storyline"):
                    q = q.where(Note.x_synth_storyline == arguments["storyline"])
                limit = int(arguments.get("limit", 50))
                rows = list(session.exec(q.order_by(Note.created_iso.desc()).limit(limit)).all())
            payload = {"as_of": as_of_iso, "count": len(rows), "notes": [_note_summary(r) for r in rows]}
            return [TextContent(type="text", text=json.dumps(payload, indent=2))]

        if name == "notes_get":
            nid = arguments["note_id"]
            with Session(engine_for(slug)) as session:
                note = session.get(Note, nid)
                if note is None or note.created_iso > as_of_iso:
                    return [TextContent(type="text", text=json.dumps({"error": "note not visible at as_of"}))]
            return [TextContent(type="text", text=render_note_as_markdown(note))]

        return [TextContent(type="text", text=json.dumps({"error": f"unknown tool: {name}"}))]

    return server


async def run_stdio_server(slug: str) -> None:
    """Entry point for stdio-transport MCP server."""
    server = build_server(slug)
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())
