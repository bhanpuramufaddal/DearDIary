"""SQLModel classes for the per-persona SQLite DB.

Tables introduced so far:
  - Persona            (Stage 0)
  - AgentRun, AgentToolCall, LlmCall   (observability, all stages)
  - Cast               (Stage 2 — structured sidecar to cast.md prose)
  - Storyline, DeclaredMoment, MomentSupportingArtifact, NoiseEvent,
    NoiseEffect, PlannedArtifact   (Stage 5 — storyline-first authoring)

Later phases will add Email, EmailAttachment, EmailThread, Note,
InitialCalendarEvent, CalendarOp, ValidationLog.
"""

from __future__ import annotations

from sqlmodel import Field, SQLModel


class Persona(SQLModel, table=True):
    __tablename__ = "personas"
    slug: str = Field(primary_key=True)
    name: str
    prompt_text: str
    seed_hex: str
    window_start_date: str
    window_end_date: str
    created_at: str


class AgentRun(SQLModel, table=True):
    __tablename__ = "agent_runs"
    run_id: str = Field(primary_key=True)
    stage_id: str
    started_at: str
    finished_at: str | None = None
    success: int | None = None  # 0/1/null
    error: str | None = None


class AgentToolCall(SQLModel, table=True):
    __tablename__ = "agent_tool_calls"
    turn_id: int | None = Field(default=None, primary_key=True)
    run_id: str = Field(foreign_key="agent_runs.run_id")
    ts_iso: str
    tool_name: str
    args_json: str | None = None
    result_summary: str | None = None


class Cast(SQLModel, table=True):
    __tablename__ = "cast"
    cast_id: str = Field(primary_key=True)
    display_name: str
    signal_tier: str  # one of: p0 | p1 | p2 | p3 | p4
    role_brief: str | None = None


class Storyline(SQLModel, table=True):
    __tablename__ = "storylines"
    storyline_id: str = Field(primary_key=True)
    display_name: str
    arc_path: str  # relative to persona working dir, e.g. internal/storylines/series_a_raise/arc.md


class DeclaredMoment(SQLModel, table=True):
    __tablename__ = "declared_moments"
    moment_id: str = Field(primary_key=True)
    storyline_id: str = Field(foreign_key="storylines.storyline_id", index=True)
    target_morning: str = Field(index=True)  # ISO date
    section: str  # if_one_thing | urgent_todo | decisions_approvals | ai_news | team_pulse | calendar_personal
    priority: str  # P0 | P1 | P2
    action_class: str  # dispatch_immediate | reply_short | decide | approve | track | fyi
    rationale: str
    initial_lifecycle: str = Field(default="DECLARED")


class MomentSupportingArtifact(SQLModel, table=True):
    __tablename__ = "moment_supporting_artifacts"
    moment_id: str = Field(primary_key=True, foreign_key="declared_moments.moment_id")
    artifact_id: str = Field(primary_key=True)  # FK to planned_artifacts.artifact_id (enforced by RI sweep)


class NoiseEvent(SQLModel, table=True):
    __tablename__ = "noise_events"
    noise_id: str = Field(primary_key=True)
    storyline_id: str = Field(foreign_key="storylines.storyline_id", index=True)
    occurrence_date: str  # ISO date
    triggers_artifact_id: str | None = None


class NoiseEffect(SQLModel, table=True):
    __tablename__ = "noise_effects"
    effect_id: int | None = Field(default=None, primary_key=True)
    noise_id: str = Field(foreign_key="noise_events.noise_id", index=True)
    target_moment_id: str = Field(foreign_key="declared_moments.moment_id", index=True)
    effect_kind: str  # SHIFTED | CANCELED | MODIFIED | DECLARED
    effective_from: str = Field(index=True)  # ISO date
    new_target_morning: str | None = None
    new_rationale: str | None = None
    new_priority: str | None = None


class PlannedArtifact(SQLModel, table=True):
    __tablename__ = "planned_artifacts"
    artifact_id: str = Field(primary_key=True)
    storyline_id: str = Field(foreign_key="storylines.storyline_id", index=True)
    target_render_date: str = Field(index=True)  # ISO date — coarse-grained day
    # Full synthetic timestamp the digest agent treats as the artifact's real
    # arrival/creation time. ISO 8601 with TZ offset (e.g. '2026-04-24T07:42:00-07:00').
    # Nullable so Stage 5 can declare without precise time and the backfill helper
    # in artifact_time.py assigns a deterministic per-kind plausible minute.
    target_render_iso: str | None = None
    kind: str  # email | note | calendar_invite | calendar_update
    content_sketch: str | None = None
    is_decoy: int = Field(default=0)  # 0/1


class LlmCall(SQLModel, table=True):
    __tablename__ = "llm_calls"
    call_id: str = Field(primary_key=True)
    run_id: str | None = Field(default=None, foreign_key="agent_runs.run_id")
    ts_iso: str
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    latency_ms: int | None = None
    success: int | None = None


class InitialCalendarEvent(SQLModel, table=True):
    __tablename__ = "initial_calendar_events"
    event_id: str = Field(primary_key=True)
    title: str
    start_iso: str
    end_iso: str
    attendees_json: str | None = None
    recurring_rrule: str | None = None
    calendar_id: str = Field(default="primary")


class Email(SQLModel, table=True):
    __tablename__ = "emails"
    message_id: str = Field(primary_key=True)
    artifact_id: str | None = Field(default=None, foreign_key="planned_artifacts.artifact_id")
    thread_id: str | None = None
    from_addr: str
    to_addrs_json: str
    cc_addrs_json: str | None = None
    subject: str
    date_iso: str = Field(index=True)
    in_reply_to: str | None = None
    body: str
    x_synth_storyline: str | None = Field(default=None, index=True)
    x_synth_moment_id: str | None = None
    x_synth_tonal_zone: str | None = None
    x_synth_decoy: int = Field(default=0)
    x_synth_source_plan: str | None = None
    x_synth_calendar_op_id: str | None = None


class EmailThread(SQLModel, table=True):
    __tablename__ = "email_threads"
    thread_id: str = Field(primary_key=True)
    root_message_id: str
    subject: str


class EmailAttachment(SQLModel, table=True):
    __tablename__ = "email_attachments"
    attachment_id: str = Field(primary_key=True)
    message_id: str = Field(foreign_key="emails.message_id", index=True)
    filename: str
    mime_type: str  # e.g. 'application/pdf', 'text/csv', 'text/markdown', 'image/png'
    content: bytes  # SQLite BLOB; LLM-emitted text is UTF-8 encoded here


class Note(SQLModel, table=True):
    __tablename__ = "notes"
    note_id: str = Field(primary_key=True)
    artifact_id: str | None = Field(default=None, foreign_key="planned_artifacts.artifact_id")
    filename: str = Field(unique=True)
    title: str | None = None
    body: str
    created_iso: str = Field(index=True)
    updated_iso: str | None = None
    x_synth_storyline: str | None = None
    x_synth_moment_id: str | None = None
    x_synth_tonal_zone: str | None = None
    x_synth_source_plan: str | None = None


class CalendarOp(SQLModel, table=True):
    __tablename__ = "calendar_ops"
    op_id: int | None = Field(default=None, primary_key=True)
    ts_iso: str = Field(index=True)
    op: str  # add_event | move_event | cancel_event | accept_invite | decline_invite | tentative_invite | update_event
    event_id: str = Field(index=True)
    source: str  # direct | email
    linked_message_id: str | None = Field(default=None, foreign_key="emails.message_id")
    payload_json: str


class ValidationLog(SQLModel, table=True):
    __tablename__ = "validation_log"
    moment_id: str = Field(primary_key=True, foreign_key="declared_moments.moment_id")
    status: str  # pass | fail | correct
    justification: str
    reason: str | None = None
    severity: str | None = None
    corrected_rationale: str | None = None
    corrected_priority: str | None = None
    validated_at: str
