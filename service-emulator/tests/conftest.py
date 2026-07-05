"""Shared fixtures: temp data root + a seeded persona.db with sample artifacts."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlmodel import Session

from persona_generator.db import data_root, engine_for, init_db
from persona_generator.models import (
    CalendarOp,
    Email,
    EmailAttachment,
    InitialCalendarEvent,
    Note,
    PlannedArtifact,
    Storyline,
)

SLUG = "test_em"


@pytest.fixture
def temp_data_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "data" / "personas"
    root.mkdir(parents=True)
    monkeypatch.setenv("PERSONA_DATA_ROOT", str(root))
    return root


@pytest.fixture
def seeded_db(temp_data_root):
    """Init a DB with a storyline + 3 emails + 1 attachment + 1 note + 2 calendar events + 2 ops."""
    init_db(SLUG)
    with Session(engine_for(SLUG)) as session:
        session.add(Storyline(storyline_id="s1", display_name="S1", arc_path="x"))
        session.commit()
    with Session(engine_for(SLUG)) as session:
        session.add(PlannedArtifact(artifact_id="a1", storyline_id="s1", target_render_date="2026-04-24", kind="email", is_decoy=0))
        session.add(PlannedArtifact(artifact_id="a2", storyline_id="s1", target_render_date="2026-04-24", kind="email", is_decoy=1))
        session.add(PlannedArtifact(artifact_id="a3", storyline_id="s1", target_render_date="2026-04-25", kind="email", is_decoy=0))
        session.add(PlannedArtifact(artifact_id="n1", storyline_id="s1", target_render_date="2026-04-24", kind="note", is_decoy=0))
        session.commit()
    with Session(engine_for(SLUG)) as session:
        session.add(Email(message_id="<early@x>", artifact_id="a1", from_addr="mary@bessemer.com",
                          to_addrs_json='["avery@plumb.so"]', subject="Q1 metrics",
                          date_iso="2026-04-24T07:30:00-07:00", body="Could you slice this two ways?",
                          x_synth_storyline="s1", x_synth_tonal_zone="professional_front_stage"))
        session.add(Email(message_id="<decoy@x>", artifact_id="a2", from_addr="bills@stripe.com",
                          to_addrs_json='["avery@plumb.so"]', subject="Your monthly invoice",
                          date_iso="2026-04-24T03:00:00-07:00", body="Automated invoice", x_synth_decoy=1))
        session.add(Email(message_id="<late@x>", artifact_id="a3", from_addr="avery@plumb.so",
                          to_addrs_json='["mary@bessemer.com"]', subject="Re: Q1 metrics",
                          date_iso="2026-04-25T08:15:00-07:00", in_reply_to="<early@x>",
                          body="Cohort 1 was..."))
        session.add(EmailAttachment(attachment_id="att1", message_id="<late@x>",
                                    filename="q1_metrics.csv", mime_type="text/csv",
                                    content=b"month,arr\n2026-01,1100000\n"))
        session.add(Note(note_id="n1", artifact_id="n1", filename="morning-log-apr-24.md",
                         title="Morning log Apr 24", body="dataroom — Mary 4 views",
                         created_iso="2026-04-24T06:30:00-07:00",
                         x_synth_storyline="s1"))
        session.add(InitialCalendarEvent(event_id="e_standup", title="Daily standup",
                                         start_iso="2026-04-20T10:00:00-07:00",
                                         end_iso="2026-04-20T10:15:00-07:00",
                                         attendees_json='["team@plumb.so"]',
                                         recurring_rrule="FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR"))
        session.add(InitialCalendarEvent(event_id="e_board",
                                         title="Board meeting",
                                         start_iso="2026-05-14T10:00:00-07:00",
                                         end_iso="2026-05-14T13:00:00-07:00",
                                         attendees_json='[]'))
        session.commit()
    with Session(engine_for(SLUG)) as session:
        session.add(CalendarOp(ts_iso="2026-04-24T09:00:00-07:00", op="move_event",
                               event_id="e_standup", source="direct",
                               payload_json='{"new_start_iso":"2026-04-24T11:00:00-07:00","new_end_iso":"2026-04-24T11:15:00-07:00"}'))
        session.add(CalendarOp(ts_iso="2026-04-25T14:00:00-07:00", op="cancel_event",
                               event_id="e_board", source="direct",
                               payload_json='{"reason":"Mary IC pushed"}'))
        session.commit()
    yield SLUG
