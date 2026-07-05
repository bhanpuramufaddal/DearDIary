# Output Formats

Format specs for the artifacts the digest agent reads (as served by the service emulator), and for the eval ground truth.

## What the digest agent reads — and how

The digest agent never opens `persona.db` directly. It talks to the **service emulator**, which serves rows from `persona.db` as production-shaped responses over REST + MCP:

| Source surface | Served by | Real format the digest sees |
|---|---|---|
| `profile.md` | Read from disk (single document) | Markdown |
| Emails | mail-service emulator (`GET /messages`, `mail.list_messages` MCP tool, etc.) | RFC 822 `.eml` rendered from `emails` rows |
| Calendar state | calendar-service emulator (`GET /events`, `mail.get_snapshot(as_of)` MCP tool) | iCalendar `.ics` computed from `initial_calendar_events` + `calendar_ops` rows on demand |
| Notes | notes-service emulator (`GET /notes`, `notes.list_notes` MCP tool) | Markdown rendered from `notes` rows |

The agent's interface is identical in shape to production (real Gmail, real Google Calendar, a real notes API). Swap the emulator for a real service and the agent runs unchanged.

What the digest does **not** read:
- Anything in `internal/` (life context, character sketch, judgment, cast prose, storyline arcs, daily state)
- Anything in `persona.db` directly (declared_moments, noise_events, validation_log, observability tables)
- `ideal_digests/` (eval ground truth, not input)

## Emails — `.eml` (RFC 822, served from DB)

The mail service emulator renders RFC 822 `.eml` content from `emails` rows on demand. Each `emails` row maps 1:1 to one `.eml` response. The `body` column is the email body; the `x_synth_*` columns become hidden headers. Standard RFC 822 with a small extension: hidden `X-Synth-*` headers carry extract metadata so the eval harness can grade without parsing prose.

```
From: marcus.webb@andreessen-horowitz.example <marcus.webb@andreessen-horowitz.example>
To: avery@tessera.example
Subject: Re: IC next Thursday — proposed agenda
Date: Mon, 18 May 2026 14:31:00 -0700
Message-ID: <2026-05-18-marcus-ic-agenda@tessera.example>
X-Synth-Storyline: series_a_raise
X-Synth-Tonal-Zone: professional_front_stage
X-Synth-Source-Moment: series_a_raise.moment_marcus_ic_agenda
X-Synth-Decoy: false
X-Synth-Calendar-Op-Id:                    # set only if this email drove a calendar op

Avery —

Quick agenda for Thursday's IC. We'll spend the first 30 min on …
```

Header conventions:

- `X-Synth-Storyline` — `storyline_id` from the `storylines` table. Decoys and texture-noise emails may set this to `none` or to the storyline they're decoying away from.
- `X-Synth-Tonal-Zone` — one of `public_front_stage`, `professional_front_stage`, `internal_mid_stage`, `private_back_stage`.
- `X-Synth-Source-Moment` — `moment_id` from `declared_moments` that this artifact supports (matches the `x_synth_moment_id` column on the `emails` row).
- `X-Synth-Decoy: true|false` — explicit decoy flag for suppression-discipline grading.
- `X-Synth-Calendar-Op-Id` — for bidirectional correlation, emails that drove a calendar op carry the op ID. Allows the eval harness to verify the email↔calendar link.

The body is plain text or HTML, persona voice, tonal zone honored.

## Calendar — `.ics` (iCalendar, served from DB)

Standard `VCALENDAR` with `VEVENT` blocks. The calendar service emulator computes the `.ics` representation on demand by replaying `calendar_ops` rows against `initial_calendar_events` rows up to a given timestamp.

### The op model

The calendar is never stored as `.ics` — it's an initial state plus an append-only log of operations, replayed on demand. Each row in `calendar_ops`:

| Column | Example | Notes |
|---|---|---|
| `ts_iso` | `2026-05-20T17:31:00-07:00` | When the op happened in the persona's world |
| `op` | `move_event` | `add_event` / `move_event` / `cancel_event` / `accept_invite` / `decline_invite` / `tentative_invite` / `update_event` |
| `event_id` | `evt_lumen_demo` | Target event |
| `source` | `email` | `direct` (changed in the calendar app) or `email` (driven by an email) |
| `linked_message_id` | `<2026-05-20-lumen@...>` | FK to `emails.message_id` if `source = email`; NULL otherwise |
| `payload_json` | `{"new_start": ..., "new_end": ...}` | Op-specific fields |

- **The contradiction case is the absence of an op** while an email exists that implies a calendar change. Stage 7 intentionally emits such email-without-op pairs to create organic email↔calendar drift. The eval harness joins `emails` ⋈ `calendar_ops` on `linked_message_id` to detect them.

### Replay semantics (in the calendar service emulator, on demand)

When the consumer requests calendar state as of timestamp T (via `GET /calendars/primary/events?as_of=T` or the equivalent MCP tool), the emulator runs:

```sql
SELECT * FROM initial_calendar_events;
SELECT * FROM calendar_ops WHERE ts_iso <= :T ORDER BY ts_iso;
```

…and applies the ops in order:

- `add_event` → new `VEVENT`, `SEQUENCE:0`.
- `move_event` → bump `SEQUENCE`, update `DTSTART`/`DTEND`, set `LAST-MODIFIED`.
- `cancel_event` → `STATUS:CANCELLED` + bump `SEQUENCE`.
- `decline_invite` → `ATTENDEE;PARTSTAT=DECLINED`.

Output: a `.ics` blob (or a typed event list, depending on which API the consumer called) representing the calendar at time T. Deterministic — same DB state, same T, same output bytes. Cheap — one indexed query plus an in-memory walk.

## Notes — `.md` (served from DB)

Plain markdown rendered from `notes` rows by the notes service emulator. Each row's `body` column is the markdown content; YAML frontmatter is reconstructed from the `title` / `created_iso` / `updated_iso` / `x_synth_*` columns when the emulator serializes the response. The digest sees the markdown directly. Counts and content emerge from each storyline's `planned_artifacts` rows.

## Ideal digest — `ideal_digests/morning_NN.json`

Eval ground truth. One file per eval morning (Days 6 through 35, 30 files). Every field traces to its source plan + validation log entry. Full provenance from authored moment → cascade-modified moment → validated moment → emitted item.

```json
{
  "for_date": "2026-05-21",
  "based_on_state_through": "2026-05-20T23:59:59-07:00",
  "items": [
    {
      "moment_id": "series_a_raise.moment_marcus_ic_dayof",
      "storyline_id": "series_a_raise",
      "section": "calendar_personal",
      "priority": "P0",
      "action_class": "track",
      "should_draft_reply": false,
      "draft_tone_zone": null,
      "rationale": "Marcus IC at 2pm today",
      "supporting_artifact_ids": ["d10_calevt_marcus_ic"],
      "lifecycle_history": [
        { "state": "DECLARED",  "from_date": "2026-04-19", "by": "stage_5_authoring" },
        { "state": "SHIFTED",   "from_date": "2026-04-27", "by": "noise_marcus_ic_pushed", "new_target": "2026-05-21" }
      ],
      "validation_status": "pass",
      "validation_log_moment_id": "series_a_raise.moment_marcus_ic_dayof"
    }
  ],
  "expected_suppressions": [
    {
      "artifact_id": "d14_email_stratechery_newsletter",
      "is_decoy": true,
      "storyline_id": "series_a_raise",
      "rationale": "newsletter form; content not relevant to active raise"
    }
  ]
}
```

Field notes:

- `priority` — one of `P0`, `P1`, `P2`, `P3`.
- `action_class` — what the digest is asking the persona to do (`track`, `reply`, `decide`, `prepare`, etc.).
- `should_draft_reply` — whether a drafted reply should accompany this item.
- `draft_tone_zone` — the tonal zone to use for the draft (matches `X-Synth-Tonal-Zone` in `.eml`).
- `lifecycle_history[]` — chronological state transitions for this moment.
- `validation_status` — `pass` or `correct` (failed items are excluded at assembly).
- `validation_log_moment_id` — primary key into the `validation_log` table for traceability. The full row (`status`, `justification`, `corrected_rationale`, etc.) can be looked up by joining on `moment_id`.
- `expected_suppressions[]` — artifacts the digest is expected to ignore. Decoys flagged explicitly.

## Where structured data lives now (replacing the old JSON sidecars)

All structured data that the old design carried as thin JSON/JSONL sidecars now lives in `persona.db`. Identity, cast IDs, storyline IDs, validation outcomes, initial calendar events — all SQL tables. Full schema in [10-storage.md](10-storage.md).

The one structured artifact still on disk is `ideal_digests/morning_NN.json` — kept as files because the eval harness consumes them as JSON and that's the simplest consumer contract.

If a row in `persona.db` contradicts an `ideal_digests/morning_NN.json` file, the DB is the source of truth and the JSON gets regenerated by re-running Stage 9b's query.
