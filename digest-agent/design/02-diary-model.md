# The Diary Model

The **diary** is the principal-facing output. One structured artifact per day. Everything the principal sees lives here. The diary is the [sole contract](00-architecture-overview.md) between the cognitive core and the world.

This doc specifies the agent-visible JSON shape, the four sections, the A2UI component taxonomy, the HITL template library, per-component comments and bottom notes, action affordances (and the execution boundary), the thinking layer, carry-forward, and day-boundary semantics.

## Storage and shape

Diaries persist in SQLite (`digest.db`), decomposed across `diary_days`, `diary_components`, `diary_component_anchor_refs`, `diary_comments`, `diary_notes`, `diary_thinking_entries`. See [11-backend-architecture.md](11-backend-architecture.md#schema-ddl) for the table definitions.

The JSON document below is the **agent-visible / on-the-wire shape**. The storage layer assembles it from `diary_*` rows on read (`digest_get`, `run_sql` reads, the renderer's diary view) and builds those rows on write — the diary agent's per-template `write_<template>` tools for components, `diary_add_comment` / `diary_add_note` for principal annotations. There is no single `write_diary` call and no diary JSON file; the document exists only as the assembled view over rows.

**Today's is live.** Each diary tick rewrites today's `diary_components` rows; the thinking layer is appended.

**Yesterday's is frozen.** Once the principal's clock crosses midnight, yesterday's components are sealed. The diary agent may read them for carry-forward but never to revise.

Top-level shape:

```json
{
  "date": "2026-05-23",
  "sections": {
    "right_now":   [ /* components */ ],
    "on_the_desk": [ /* components */ ],
    "tracking":    [ /* components */ ],
    "background":  [ /* components */ ]
  },
  "notes": [
    {
      "id": "note_20260523_0712_001",
      "text": "running late on the cap table — push tonight",
      "created_at": "2026-05-23T07:12:04-07:00"
    }
  ],
  "thinking_layer": [
    {
      "tick_at": "2026-05-23T06:47:12-07:00",
      "entries": [
        "Marcus anchor activation 0.74; quiet within range.",
        "Renee Halberd EOD deadline -> lead component."
      ]
    }
  ]
}
```

Three first-class fields:

- `sections` — the four cognitive sections, each holding ordered components. **Speech-side.** Rewritten on every diary tick.
- `notes` — principal-authored free-form scratch. Append-only across the day; never rewritten.
- `thinking_layer` — agent journal of its reasoning across the day's ticks. Append-only.

Two fields a reader might expect but won't find: `timezone` is read from `config.jsonc` at every read (the diary's timezone never diverges from the config's), and `generated_at` is unnecessary (the `diary_*` rows carry their own timestamps). Neither belongs in the JSON.

## The four sections

The sections are **semantic, not topical** — they sort by what the principal must do with an item, not by source. An email and a calendar conflict can share a section if both demand judgment before EOD.

- **`right_now`** — needs judgment, signature, reply, or attention before end-of-day. Top of the document. Typically 1–3 items. Anything more is a triage failure.
- **`on_the_desk`** — dispatchable items the principal can take in under a minute: drafted replies, accept/decline decisions, doc acknowledgments. **Artifact over suggestion**: don't say "you should reply to Renee"; produce the reply.
- **`tracking`** — open loops the agent is watching. No action this cycle. Each item carries the expectation that would move it ("if Marcus doesn't reply by Monday afternoon, this moves up"). May grow long; the principal scanning it is doing situational awareness.
- **`background`** — quieter matters: stable anchors, periodic obligations not yet due. The visible silence.

## Component schema

A component is an object inside a section's array.

```json
{
  "id": "cmp_20260523_0647_001",
  "type": "email-draft",
  "template_id": "email-draft.inline",
  "anchor_refs": ["renee_tan", "halberd_manufacturing", "halberd_rollout"],
  "headline": "Reply to Renee at Halberd — yes on May 28 rollout",
  "rationale": "Her stakeholder meeting is tomorrow morning; she needs a yes/no on the May 28 rollout by EOD. Jordan confirmed Tuesday engineering is on track — answer is yes.",
  "content": {
    "to": "renee.tan@halberd.com",
    "cc": [],
    "subject": "Re: May 28 rollout — go/no-go",
    "body": "yes, may 28 still on. jordan confirmed eng is on track tuesday.\nwe'll flag if anything changes before then.\navery",
    "source_thread_id": "thread_4f2a",
    "source_message_id": "msg_8b3c"
  },
  "actions": [
    {"id": "send",    "label": "Send",    "kind": "send_email"},
    {"id": "edit",    "label": "Edit",    "kind": "edit_email"},
    {"id": "discard", "label": "Discard", "kind": "discard"}
  ],
  "status": "open",
  "comments": [],
  "efference_prediction_id": "efference_2026-05-23_018"
}
```

Fields:

- `id` — stable per component (PK of `diary_components`); minted at creation. New ticks mint new ids; carried-forward components mint new ids too (the previous tick's id is dead).
- `type` — one of the nine component types below. The `template_id` is always `<type>.<variant>`, so the type is recoverable from it.
- `template_id` — selects which HITL template renders this component (one of the 11 registry entries). See "HITL template library" below.
- `anchor_refs` — list of anchor ids the component relates to (junction rows in `diary_component_anchor_refs`). The first entry is the primary anchor; the efference prediction (if any) lives on it.
- `headline` — short human-readable heading.
- `rationale` — the agent's judgment note: why this is here, why now.
- `content` — typed payload; shape depends on `type`. See "Component types" below.
- `actions` — affordances available to the principal. Each has an `id` (stable within the component), a `label`, and a `kind` the execution dispatcher's spawned Claude Code instance understands.
- `status` — `open | acted | closed | dismissed`. See "Component status" below.
- `comments` — per-component principal comments; see "Per-component comments" below.
- `efference_prediction_id` — present on dispatchable components. FK into `predictions`; the prediction itself (claim, expected_by, precision, etc.) lives on the primary anchor, not duplicated here. See [01-anchor-model.md](01-anchor-model.md) and [03a-agent-shape.md#prediction_object](03a-agent-shape.md#prediction_object). The pointer matches `predictions.source_dispatchable = "diary/<date>#<component_id>"` from the other direction.

There's no `section` field on the component. The component's `diary_components.section` column drives array placement under `sections.right_now[]` / `on_the_desk[]` / `tracking[]` / `background[]` when the diary is assembled.

## Component types

Nine types, split into two families: **dispatchable** components that carry actions the principal fires, and **informational** components that present what the agent wants the principal to see. The taxonomy is closed — the agent picks a `template_id` from the registry (`src/shared/templates/`); it does not invent new types at runtime. Each type maps to one or more registry templates (`<type>.<variant>`); the full catalog is in "HITL template library" below.

### Dispatchable

**`email-draft`** — a send-ready drafted reply, with a paraphrased `context_summary` above the draft body.

```json
"type": "email-draft",
"content": {
  "context_summary": "Renee needs a go/no-go on the May 28 rollout before her stakeholder meeting tomorrow; Jordan confirmed eng is on track.",
  "to": ["renee.tan@halberd.com"],
  "cc": [],
  "subject": "Re: May 28 rollout — go/no-go",
  "body": "...",
  "source_thread_id": "thread_4f2a",
  "source_message_id": "msg_8b3c"
},
"actions": [
  {"id": "send",    "label": "Send",    "kind": "send_email"},
  {"id": "edit",    "label": "Edit",    "kind": "edit_email"},
  {"id": "discard", "label": "Discard", "kind": "discard"}
]
```

**`calendar-block`** — a calendar event needing a response or block (accept / decline / propose).

```json
"type": "calendar-block",
"content": {
  "summary": "Northstar quarterly sync",
  "start": "2026-05-29T14:00:00-07:00",
  "duration_minutes": 60,
  "intent": "decline",
  "response_note": "can't make it this quarter; will read the notes when they go out."
},
"actions": [
  {"id": "accept",  "label": "Accept",            "kind": "accept_event"},
  {"id": "decline", "label": "Decline",           "kind": "decline_event"},
  {"id": "propose", "label": "Propose new time",  "kind": "propose_time"}
]
```

**`choose-one`** — a forced pick among 2–5 mutually exclusive options when the decision isn't a native binary.

```json
"type": "choose-one",
"content": {
  "prompt": "Posture for the next Marcus touchpoint",
  "options": [
    {"id": "hold",       "label": "Hold — no outbound",               "detail": "Default for healthy diligence."},
    {"id": "soft_nudge", "label": "Soft nudge — confirm Tuesday",     "detail": "Low-risk; reaffirms commitment."},
    {"id": "preview",    "label": "Preview — send option-pool slide", "detail": "Forward motion; small risk of pre-empting."}
  ]
},
"actions": [
  {"id": "pick", "label": "Pick", "kind": "pick_option"}
]
```

**`free-text-reply`** — fallback when even choose-one would force a false binary; the principal writes the reply, the agent dispatches it.

```json
"type": "free-text-reply",
"content": {
  "prompt": "Reply to Dr. Chen's office about Thursday 10am rescheduling",
  "channel": "email",
  "to": "scheduling@chenpediatrics.com",
  "source_thread_id": "thread_med_07"
},
"actions": [
  {"id": "send", "label": "Send", "kind": "send_email"}
]
```

### Informational

These carry no execution affordance (their `actions` are empty or display-only). They replaced the old `doc-tile` "here's something to look at" component with a richer set tuned to *what kind* of thing is worth seeing.

- **`diary-prose`** — paraphrased prose in the diary's own voice. `diary-prose.note` for "something worth knowing"; `diary-prose.flash` for the urgent "see this right now" surface (at most 1–2/day). This is where a document worth glancing at, a heads-up, or a narrated observation lands — the doc-reference use case folded into prose.
- **`big-number`** — one hero metric (label + value + delta + optional sparkline) with a paraphrased context paragraph. For "ARR crossed $2.4M" moments.
- **`stat-block`** — 3–6 metric rows plus a context paragraph naming the cluster story. For a small dashboard of related numbers.
- **`chart`** — a data visualization with a context paragraph. `chart.timeseries` (line/area over time) or `chart.bar` (categorical).
- **`report`** — a short structured brief: 2–6 prose blocks interleaved with up to 2 inline charts. The narrative carries the argument; charts illustrate.

**No `task-item`.** Tasks unified into notes on the input side; todos surface as ordinary text inside notes or as `free-text-reply` components when the principal needs to record one. The architecture refuses a dedicated task component to keep the input model — three sources, no task source — clean.

**No `doc-tile`.** An earlier cut had a `doc-tile` "open this document" component. It was dropped: a bare link is thin, and the cases it covered are better served by `diary-prose` (a narrated heads-up that can cite the source) or `report.brief` (when the document's substance is worth summarizing inline). Source references travel as `source_*` ids inside a component's content or as case-base citations, not as their own component type.

## HITL template library

Each dispatchable component carries a `template_id` field that selects which visual template renders it. The renderer ships a library of templates per component type — same data, different visual treatment tuned to context. The diary agent chooses a `template_id` when writing each component; the prompt enumerates the available catalog.

This is what makes the diary feel like a diary, not a JSON dump. Components aren't rendered uniformly; they're rendered through the template that fits the situation.

Template catalog (11 templates across the nine component types — the registry in `src/shared/templates/`):

| `template_id` | Component type | Visual |
|---|---|---|
| `email-draft.inline` | `email-draft` | Paraphrased `context_summary` above; recipient + subject header strip; body as a paragraph block; Send / Edit / Discard. |
| `calendar-block.decision` | `calendar-block` | Event title + a time-block stripe; attendee chips; Accept / Decline / Propose-new-time. Optional `response_note` becomes a small text input revealed under Decline / Propose. |
| `choose-one.cards` | `choose-one` | Prompt as header; each option a card with label + detail; one Pick button per card. |
| `free-text-reply.compose` | `free-text-reply` | Prompt as header; textarea sized to the expected reply length; Send button. Recipient/channel is a subtle hint above. |
| `diary-prose.note` | `diary-prose` | Paraphrased prose in the diary's voice — a narrated note. No action buttons. |
| `diary-prose.flash` | `diary-prose` | Same, but the urgent "see this now" treatment. At most 1–2/day. |
| `big-number.metric` | `big-number` | One hero number (label + value + delta + optional sparkline) with a context paragraph. |
| `stat-block.summary` | `stat-block` | 3–6 metric rows + a context paragraph naming the cluster story. |
| `chart.timeseries` | `chart` | Line/area chart over time + context paragraph. |
| `chart.bar` | `chart` | Categorical bar chart (2–20 bars) + context paragraph. |
| `report.brief` | `report` | 2–6 prose blocks interleaved with up to 2 inline charts. |

Each component type maps to one tool per template (`write_email_draft_inline`, `write_diary_prose_flash`, `write_chart_bar`, …); the diary agent calls the tool whose template fits the situation, and the tool validates the content against that template's schema. Templates share the diary's journal aesthetic — serif headings, generous margins, prose-like paragraph rhythm. Status indicators are marginalia (small inked glyphs in the outer margin), not button-label flips. See the diary aesthetic section in [11-backend-architecture.md](11-backend-architecture.md) for the visual direction.

**Expanding the library is additive.** New templates land as new modules in `src/renderer/diary/templates/`; the diary agent's prompt is updated to mention the new catalog entries; existing components keep using their original `template_id` (the renderer falls back to the type's default template if a `template_id` is unrecognized).

## Component status

```
open      → freshly produced; no action taken
acted     → calling agent confirmed it ran an action (via diary_act)
closed    → no longer relevant; the matter resolved without the action
dismissed → principal told it to go away (via diary_add_comment or implicit)
```

Status transitions:

- `open` → `acted`: set by the execution dispatcher when the task it spawned completes successfully (the spawned Claude Code subprocess actually performed the action). This is on the success path of the `task.fired` → `task.completed` flow.
- `open` → `closed`: set by the diary agent on a subsequent tick when it determines the matter resolved without the action (e.g., the email got answered through another channel).
- `open` → `dismissed`: set when the principal explicitly tells the system to drop the component (via a comment like "ignore this" or an explicit dismiss action on the renderer).
- `open` → `open` after `task.failed`: stays open; the execution dispatcher's `task.failed` event flows to the mind dispatcher, which can update the component's rationale via the next diary tick.

A status-`acted` component stays in the diary for the rest of the day for visibility (renderer desaturates it and draws a marginalia check). The next day's diary either carries it forward in a follow-up form or drops it entirely.

## Per-component comments

Every component has a `comments` array (rows in `diary_comments`). Both surfaces — the Electron diary view and the Claude Code MCP plugin — expose a per-component comment affordance. Two paths in:

- **Electron diary view.** The principal types a comment under the component; the renderer calls `window.digest.addComment({ component_id, text })` over IPC; the main process inserts a `diary_comments` row and emits `diary.comment.added` on the bus.
- **Claude Code MCP plugin.** The principal (or their Claude Code) calls `diary_add_comment(component_id, text)` on the surface MCP server; the server inserts the row and emits the same bus event.

Both paths land identically. The mind dispatcher subscribes to `diary.comment.added` and spawns a Claude Code mind invocation with the comment as the event payload. The cognitive substrate updates accordingly.

A comment is a real-time input from the principal; it must update the artifact and reach the cognitive core. The atomic row-write + event-emit guarantees both.

Comment shape:

```json
{
  "id": "cmt_20260523_0853_001",
  "text": "decline this; I told them last quarter I was done",
  "created_at": "2026-05-23T08:53:11-07:00"
}
```

Comments are principal-authored only — no `author` field, because there's only one author. The calling agent's completion signal arrives via `diary_act` and lands in the component's status / result payload, not in comments.

## Bottom-of-diary notes

The `notes` array at the JSON root holds principal-authored free-form text (rows in `diary_notes`). Same submit path as comments — two surfaces, one outcome:

- Diary view: `window.digest.addNote({ date, text })` → IPC → row insert → `diary.note.added` emitted.
- MCP plugin: `diary_add_note(date, text)` → row insert → same event.

Notes are the principal's scratchpad and todo list. The mind agent reads them like any other observation: a note saying "draft Q2 board update by Friday" becomes input to the anchor model and may resurface as a `free-text-reply` or `diary-prose` component in tomorrow's diary.

Notes carry across days as **still-present notes** during carry-forward — see below.

## Action affordances and the execution boundary

Component `actions` describe what the principal can ask to be done. The digest agent **never executes**. Execution lives in a separate Claude Code subprocess spawned by the execution dispatcher.

The flow:

1. Diary lands with components carrying `actions` (each `{id, label, kind}`).
2. The principal clicks an action on the diary view (or invokes `diary_act(component_id, action, principal_input)` on the MCP plugin).
3. The renderer (or surface MCP server) emits `task.fired` on the bus, carrying `{ task_id, component_id, action, principal_input, context_pointers }`.
4. The **execution dispatcher** subscribes to `task.fired`. It spawns a fresh Claude Code subprocess in permissionless mode with: an execution prompt, the external MCP servers needed for the action (gmail-mcp, gcal-mcp, …), **no substrate access**, and the task payload as input.
5. The spawned Claude Code does the work — sends the email, accepts the invite, opens the doc, whatever the `kind` calls for.
6. On exit, the execution dispatcher emits `task.completed` (success) or `task.failed` (error). On success, the dispatcher also updates the `diary_components` row's `status` to `acted`.
7. Both `task.completed` and `task.failed` flow into the mind dispatcher like any other observation. The mind agent updates the relevant anchor's case base; the efference prediction is supported or contradicted accordingly.

The digest agent never sees a tool succeed or fail directly. It observes the world's response via subsequent events (the recipient's reply lands as a Gmail webhook; the attendee accepts a counter-proposal) and through the internal `task.completed` / `task.failed` events the execution dispatcher emits.

**The world is the record of action.** The efference prediction attached to the component lives on the primary anchor and resolves when external events arrive — independent of `task.completed`. The internal task-outcome event is a faster signal for low-latency UI updates and immediate mind-agent reflection; the external observation is the canonical truth.

## Carry-forward

A common case: yesterday surfaced a drafted reply the principal neither sent nor dismissed. Today must handle the matter without behaving as if the surfacing never happened.

The diary agent composes from anchor state, entity state, plays, the principal-anchor, `profile.md`, and previous diaries. It does not read a "recent stream." When it needs historical context for a specific subject — say, Marcus's last ten emails — it queries the corresponding source via SDK-native MCP access. The case-base `source_id` entries point straight at those sources.

At composition, the diary agent reads **previous diaries as far back as useful** for the matters at hand — there is no fixed window. Routine days might only need yesterday; a re-surfacing matter from weeks ago warrants reading back to its first appearance. The agent uses `run_sql` over the `diary_*` rows — `SELECT DISTINCT diary_date FROM diary_components ORDER BY diary_date DESC` to see what's available, then a per-date `SELECT` for each day it wants. For each diary it reads:

- **Unresolved components** (status `open`) — the agent decides whether to re-surface (mint a new id, re-justify the rationale, lower the efference precision), to demote to Tracking, or to drop.
- **Still-present notes** — principal notes that are still relevant carry into today's diary as ambient context for the agent's reasoning. They are not re-listed in the new `notes` array (that array is per-day, appended to during the day), but they appear in the thinking layer's reasoning and may seed new components.
- **Dismissed and closed components** — read for what to suppress. Re-surfacing a dismissed item is a discipline failure.

The discipline under carry-forward:

- **Re-surface with adjusted framing.** "Still pending — surfaced yesterday; Renee's window has tightened to today."
- **Lower confidence.** Each unacted day is mild evidence the framing missed something. Efference precision drops; surfacing weight drops.
- **Never duplicate component `id`.** A new tick mints a new id. The previous id is dead.

The agent's job under carry-forward is to be honest about its track record. Items the principal repeatedly bypasses are evidence about the framing; items acted on quickly are evidence the framing landed.

## Thinking layer

The `thinking_layer` array at the JSON root holds the agent's reasoning journal — one row per diary tick in `diary_thinking_entries`. The diary agent calls `append_thinking_layer(date, note)` to add an entry.

**The thinking layer is never rendered in the diary view.** This is a design rule, not a polish task. The diary view is the principal's surface; the thinking layer is the agent's audit trail. Mixing them breaks the journal aesthetic and shifts the surface from "what I need today" to "what the agent thought today".

The thinking layer lives behind:

- **Inspector window** — Electron renderer accessible from the tray menu. Groups entries by date, agent role, and reasoning category. Functional aesthetic; serves debugging and review.
- **MCP plugin** — `digest_get` returns the assembled diary JSON *without* `thinking_layer`. The plugin can expose a separate `digest_get --thinking` invocation (or a dedicated tool) for power users in Claude Code who want the audit trail.

```json
"thinking_layer": [
  {
    "tick_at": "2026-05-23T06:47:12-07:00",
    "entries": [
      "Marcus anchor activation 0.74; cap table acked 3 days ago; quiet within range but flagging as a watch.",
      "Renee Halberd EOD-today deadline made this the lead component.",
      "Jordan call notes from May 19 produced a diary-prose note for the board update (not previously surfaced).",
      "Northstar quarterly suppressed as recurring; pattern of decline holds."
    ]
  },
  {
    "tick_at": "2026-05-23T13:00:00-07:00",
    "entries": [
      "No new Marcus events. Held Marcus item in Tracking; did not re-surface as Right Now.",
      "Renee replied at 11:42; her acknowledgment supported the efference prediction. Halberd item moved out of Right Now (status: closed).",
      "Sam's pediatrician reschedule arrived at 12:08. Surfaced as free-text-reply in Right Now."
    ]
  }
]
```

The thinking layer is for inspection — it answers what a curious principal or evaluator might ask. The diary view never surfaces it; Inspector and the optional `digest_get --thinking` reveal it.

## Day boundary

Every diary tick computes the current date in the principal's timezone (from `config.jsonc`) and writes the day's `diary_*` rows keyed on that date (the `diary_components.diary_date` column).

When a tick fires and the date has rolled over:

- Yesterday's `diary_components`, `diary_comments`, `diary_notes`, `diary_thinking_entries` become immutable. No tick rewrites them. The `diary_add_comment` and `diary_add_note` tools refuse writes against yesterday's `diary_date` (they return an error; the comment instead goes to today's diary as a top-level note referencing yesterday).
- A new `diary_days` row is created for today. The first tick of a new day fills in the components fresh.

The first tick of the day reads previous diaries as far back as the agent deems useful (no fixed window). Carry-forward never edits previous content.

## Length discipline

`right_now` + `on_the_desk` should fit **above the fold** in a rendered view — roughly one screen. *What the principal must engage with fits above the fold.* If those two sections grow past a screen, the agent has over-surfaced; the diary-agent prompt pushes items down to Tracking.

Tracking and Background may grow longer. The principal scanning these wants completeness more than brevity. Each item should be one paragraph at most; one sentence stating what it is, one stating what would change its status.

The thinking layer has no length discipline.

## Diary vs anchors

The diary draws from anchors; the diary is not the anchors. Anchors persist across days and evolve slowly; diaries are per-day snapshots of what the agent chose to surface. An anchor with a sharp upcoming prediction may produce a Tracking entry today and a Right Now entry tomorrow if its window closes. The anchor doesn't change form; the diary's surfacing decision does.

Every dispatchable component carries `anchor_refs` back via `diary_component_anchor_refs` rows. The efference prediction lives in the anchor (a `predictions` row), not in the diary. The diary is ephemeral output; the anchors are durable memory. Tomorrow's diary is a fresh composition over the same (updated) anchor substrate.
