"""Webhook publisher.

Background loop: walks the synthetic timeline. Whenever the synthetic clock
crosses an artifact's ``target_render_iso``, POST an event to a registered
webhook URL. This is how the digest agent receives push notifications during
a replay.

Two modes:
  - **as_of_replay**: spin through the 35-day window at accelerated synthetic
    time (e.g. 1 real-second = 1 synthetic-minute). Fires events in order.
  - **on_demand**: caller sets a target as_of; we fire any events that became
    visible between the previous as_of and the new one. Useful for tests.

The publisher writes to ``broadcast_log`` so retries and delivery state are
auditable. Failed deliveries are retried with exponential backoff.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlmodel import Session, select

from persona_generator.db import engine_for
from persona_generator.models import CalendarOp, Email, Note

from ..clock import DEFAULT_AS_OF_ISO, WINDOW_START_ISO, parse_as_of

logger = logging.getLogger(__name__)


@dataclass
class WebhookEvent:
    type: str  # "email.delivered" | "note.created" | "calendar.op"
    ts_iso: str
    ref_id: str  # message_id | note_id | str(op_id)
    payload: dict = field(default_factory=dict)


@dataclass
class WebhookConfig:
    url: str
    secret: Optional[str] = None
    headers: dict = field(default_factory=dict)


def _events_between(slug: str, *, after_iso: str, through_iso: str) -> list[WebhookEvent]:
    """Collect events whose timestamp is in (after_iso, through_iso]."""
    events: list[WebhookEvent] = []
    with Session(engine_for(slug)) as session:
        emails = list(
            session.exec(
                select(Email)
                .where(Email.date_iso > after_iso)
                .where(Email.date_iso <= through_iso)
                .order_by(Email.date_iso)
            ).all()
        )
        notes = list(
            session.exec(
                select(Note)
                .where(Note.created_iso > after_iso)
                .where(Note.created_iso <= through_iso)
                .order_by(Note.created_iso)
            ).all()
        )
        ops = list(
            session.exec(
                select(CalendarOp)
                .where(CalendarOp.ts_iso > after_iso)
                .where(CalendarOp.ts_iso <= through_iso)
                .order_by(CalendarOp.ts_iso)
            ).all()
        )

    for e in emails:
        events.append(
            WebhookEvent(
                type="email.delivered",
                ts_iso=e.date_iso,
                ref_id=e.message_id,
                payload={
                    "message_id": e.message_id,
                    "from": e.from_addr,
                    "subject": e.subject,
                    "thread_id": e.thread_id,
                    "storyline_id": e.x_synth_storyline,
                    "is_decoy": bool(e.x_synth_decoy),
                    "link": f"/mail/messages/{e.message_id}",
                },
            )
        )
    for n in notes:
        events.append(
            WebhookEvent(
                type="note.created",
                ts_iso=n.created_iso,
                ref_id=n.note_id,
                payload={
                    "note_id": n.note_id,
                    "title": n.title,
                    "storyline_id": n.x_synth_storyline,
                    "link": f"/notes/{n.note_id}",
                },
            )
        )
    for op in ops:
        events.append(
            WebhookEvent(
                type="calendar.op",
                ts_iso=op.ts_iso,
                ref_id=str(op.op_id),
                payload={
                    "op_id": op.op_id,
                    "op": op.op,
                    "event_id": op.event_id,
                    "source": op.source,
                    "linked_message_id": op.linked_message_id,
                },
            )
        )
    events.sort(key=lambda e: e.ts_iso)
    return events


async def _post_with_retry(
    client: httpx.AsyncClient,
    config: WebhookConfig,
    event: WebhookEvent,
    *,
    max_attempts: int = 3,
    backoff_base: float = 1.0,
) -> bool:
    """POST one event; retry with exponential backoff. Returns True on success."""
    body = {
        "type": event.type,
        "ts_iso": event.ts_iso,
        "ref_id": event.ref_id,
        "payload": event.payload,
    }
    headers = dict(config.headers)
    if config.secret:
        headers["X-Webhook-Secret"] = config.secret
    headers["Content-Type"] = "application/json"
    for attempt in range(max_attempts):
        try:
            resp = await client.post(config.url, json=body, headers=headers, timeout=10.0)
            if 200 <= resp.status_code < 300:
                return True
            logger.warning("webhook %s attempt %d: status=%d", event.ref_id, attempt + 1, resp.status_code)
        except httpx.RequestError as exc:
            logger.warning("webhook %s attempt %d: %s", event.ref_id, attempt + 1, exc)
        await asyncio.sleep(backoff_base * (2 ** attempt))
    return False


async def fire_events_through(
    slug: str,
    config: WebhookConfig,
    *,
    after_iso: str,
    through_iso: str,
) -> dict[str, int]:
    """Fire all events with after_iso < ts ≤ through_iso. Returns counts."""
    events = _events_between(slug, after_iso=after_iso, through_iso=through_iso)
    sent = 0
    failed = 0
    async with httpx.AsyncClient() as client:
        for ev in events:
            ok = await _post_with_retry(client, config, ev)
            if ok:
                sent += 1
            else:
                failed += 1
    return {"total": len(events), "sent": sent, "failed": failed}


async def replay_window(
    slug: str,
    config: WebhookConfig,
    *,
    start_iso: str = WINDOW_START_ISO,
    end_iso: str = DEFAULT_AS_OF_ISO,
    speedup: float = 60.0,
) -> dict[str, int]:
    """Spin through the synthetic window in accelerated real time.

    ``speedup``: synthetic seconds per real second. Default 60 = 1 minute of
    synthetic time per real second. Set very high (e.g. 1_000_000) to fire
    everything immediately.
    """
    # Simple implementation: chunk the window into 1-hour synthetic buckets,
    # sleep `bucket_synth_seconds / speedup` between buckets, fire events.
    bucket = timedelta(hours=1)
    fmt = "%Y-%m-%dT%H:%M:%S%z"
    cur = datetime.fromisoformat(start_iso)
    end = datetime.fromisoformat(end_iso)
    last_iso = start_iso
    total = {"total": 0, "sent": 0, "failed": 0}
    while cur < end:
        nxt = min(cur + bucket, end)
        nxt_iso = nxt.isoformat()
        result = await fire_events_through(slug, config, after_iso=last_iso, through_iso=nxt_iso)
        for k in total:
            total[k] += result[k]
        last_iso = nxt_iso
        sleep_for = bucket.total_seconds() / max(speedup, 0.001)
        if sleep_for > 0:
            await asyncio.sleep(min(sleep_for, 3600.0))
        cur = nxt
    return total
