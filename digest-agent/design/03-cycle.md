# The Cycle

The cycle is three discrete agent invocations on the cognitive side — a **mind agent** that fires on events, a **diary agent** that fires on schedule or on demand, and a **cold-start agent** that runs once at setup — plus a fourth subprocess kind on the execution side: a **task execution instance** spawned per principal action. All four are Claude Code subprocesses running permissionless. The orchestration logic is each agent's reasoning, not a static script.

This doc gives a tool-call sketch for each, the lazy time-handling discipline, the always-fresh guarantee, the execution lane that closes the loop, and the invariants. The role-scoped MCP tool catalogs are specified in [03a-agent-shape.md](03a-agent-shape.md); the process model and the substrate they all share are in [11-backend-architecture.md](11-backend-architecture.md). See `diagrams/cycle.excalidraw` for the topology.

## Why agents, not ticks

The previous design called these "ticks" and described them as functions with a clear control flow. They aren't. Each agent is given a system prompt, a goal, and a set of tools; it decides what to read, what to update, in what order, and when to stop.

The pseudocode in this doc shows the **tools the agent has access to and a typical sequence of calls**. It does not constrain the agent. A mind agent may inspect five anchors before deciding to update none of them. A mind agent processing one event may promote a long-accumulating entity to anchorhood. The orchestration emerges from the agent's reasoning.

## Mind agent

**Fires:** once per event. One event arrives (a webhook payload, a reminder firing, a principal comment, a principal note, a `task.completed`/`task.failed` from the execution lane); the mind dispatcher spawns a Claude Code subprocess in permissionless mode with that event as direct input.

**Goal:** integrate the event into the substrate.

**Tool surface:** exposed by `digest-substrate-mcp[mind]`. Catalog (see [03a-agent-shape.md](03a-agent-shape.md) for the authoritative allowlist and tool I/O schemas):

- Reads: `run_sql` (the single read tool — SELECT against anchors, entities, the `subjects` view, relationships, predictions, the `plays` table, reminders) plus the file readers `read_profile`, `list_playbook_sections`, `read_playbook_section`
- Substrate creation: `create_anchor` (high-conviction first sight), `create_entity` (default), `promote_entity` (graduate an accumulating entity)
- Substrate mutation: `update_anchor_layer`, `update_anchor_meta`, `bump_anchor`, `update_relationship_layer`, `update_entity`, `bump_entity`, `delete_entity`, `delete_anchor`, `delete_relationship`, `update_identity_handles`, `cite`
- Predictions + precision: `create_prediction`, `delete_prediction`, and the precision family `support_*` / `contradict_*` (for anchor layers, relationship layers, predictions — arithmetic applied)
- Reminders: `set_reminder`, `cancel_reminder`

**Plus external MCP access:** Gmail MCP, Notion MCP, Slack MCP, persona-emulator MCP, and any other server `agent_mcp_access.mind` in `config.jsonc` configures. The agent reaches for these when it needs to read evidence beyond what's in the event payload — pull the rest of a thread, walk back a calendar history, fetch a doc body.

**Not in the mind allowlist:** the diary `write_*` component family, `append_thinking_layer`, `emit_efference_prediction`, and `create_play`. The mind agent owns the substrate; it does not write the diary, and it does not author plays (a cold-start move).

**Typical sequence:**

```
mind_agent(event):
  # event payload is direct input — no queue to drain
  # Optional contextual reads, all via run_sql
  principal       = run_sql("SELECT * FROM anchors WHERE id = '_principal'")
  pending_reminders = run_sql("SELECT * FROM reminders WHERE fired_at IS NULL")

  # Decide what this event is about. The event's identity_handles
  # are hints; the agent reads payload content against anchor and
  # entity slow layers. The `subjects` view lists both in one read.
  candidates = identify_via(event,
    run_sql("SELECT id, subject_kind, name, kind FROM subjects ORDER BY last_active DESC"))

  # If evidence is thin, optionally reach out via MCP to source.
  # E.g., pull the rest of the email thread, read prior calendar
  # occurrences. The SDK provides ambient MCP access.

  for anchor_id in candidates.anchors:
    anchor = run_sql("SELECT * FROM anchors WHERE id = ?", [anchor_id])

    # Update layers per the agent's read of which layer this event
    # touches. The agent may touch one, two, or all three layers
    # depending on the evidence's durability. Content edits and
    # citations are separate calls: update_anchor_layer rewrites prose;
    # cite() appends a case_base_entries row pointing at the source ID.
    if layer_touched("slow"):
      update_anchor_layer(anchor_id, "slow", content=...)
      cite(anchor_id, source_id=event.source_id, date=..., layer="slow")
    if layer_touched("mid"):
      update_anchor_layer(anchor_id, "mid", content=...)
      cite(anchor_id, source_id=event.source_id, date=..., layer="mid")
    # confidence moves are their own tools:
    #   support_anchor_precision / contradict_anchor_precision (per layer)

    # Update each relationship's layers independently.
    for rel in anchor.relationships:
      if rel_layer_touched(rel, "slow"): update_relationship_layer(...)
      if rel_layer_touched(rel, "mid"):  update_relationship_layer(...)
      if rel_layer_touched(rel, "fast"): update_relationship_layer(...)

    # Rule on any predictions this event bears on. The precision tools
    # cascade to each anchor layer named in the prediction's based_on.
    for pred in anchor.predictions:
      if event_supports(event, pred):
        support_prediction_precision(pred.id)
      elif event_contradicts(event, pred):
        contradict_prediction_precision(pred.id)
      elif pred_irrelevant(pred):
        delete_prediction(pred.id)

    # Optionally seed new predictions for this anchor.
    maybe_create_prediction(anchor_id, kind="event|fact|pattern", precision=...)

  for entity_id in candidate_entities:
    update_entity(entity_id, notes=..., relationships=..., case_base_add=[event.source_id])

    # With fresh evidence in context, decide if this entity now
    # warrants anchorhood. Proxies: mention_count, edge density,
    # principal-anchor signals, recency. None are gates.
    if worth_promoting(entity_id, principal):
      promote_entity(entity_id, slow={...})   # same id; case base + edges carry over
      # seed standing predictions on the new anchor in the same invocation
    elif worth_dropping(entity_id):
      delete_entity(entity_id)

  # New subject? Decide between entity (default) and anchor (high-conviction).
  if subject_unknown(event):
    if first_sight_warrants_commitment(event, principal):
      create_anchor(spec=...)        # rare; e.g., term sheet from new investor
    else:
      create_entity(spec=...)        # the common case

  # Set a reminder if the event suggests revisit later.
  if event_implies_followup(event):
    set_reminder(fires_at=..., context=..., related_anchors=[...])

  # Done. Exit.
```

A typical mind-agent invocation has little to do. Most events hit zero or one anchor; many are ignorable observations the agent skims and exits past. The deep work happens during diary composition.

**No drain step.** The agent is handed exactly the event it needs to process. There is no list of pending entries to walk through, no `processed` flag to flip, no stream to read. The mind dispatcher's job is to call the agent once per event; the agent's job is to handle that event.

## Diary agent

**Fires:** on schedule (`config.jsonc`'s `diary_times`) or on demand (`digest_run` MCP tool). The diary dispatcher spawns the Claude Code subprocess in permissionless mode.

**Goal:** produce today's diary JSON.

**Tool surface:** exposed by `digest-substrate-mcp[diary]`. `run_sql` + the file readers (same as mind, including past diaries via `SELECT … FROM diary_components WHERE diary_date = ?` — dynamic carry-forward, no fixed window), plus diary-only writes:

- `write_<template>(...)` — one tool per HITL template; persists a `diary_components` row (+ its `diary_component_anchor_refs`) with content validated against the template's registry schema
- `clear_diary(date)` / `delete_diary_component(component_id)` — reset / remove components during composition
- `append_thinking_layer(date, entries)` — inserts a `diary_thinking_entries` row
- `emit_efference_prediction(anchor_id, prediction_spec)` — inserts a `predictions` row (with `source_dispatchable` set) and links it to the component

**Plus external MCP access** — same source-side servers as the mind agent (configured via `agent_mcp_access.diary`); used heavily during composition to validate drafts against source threads.

**Not in the diary allowlist:** `create_anchor`, `create_entity`, `promote_entity`, `delete_entity`, `update_anchor_layer`, `update_relationship_layer`, the precision family, `update_entity`, and every other substrate write. The diary agent reads the substrate; it does not change it. Composition-time observations that suggest substrate changes go into the day's thinking layer for the next mind invocation.

**Typical sequence:**

```
diary_agent:
  # Always-fresh is guaranteed by the diary dispatcher before this fires.
  # See "Always-fresh: how it's enforced" below.

  # Load context.
  profile     = read_profile()
  principal   = run_sql("SELECT * FROM anchors WHERE id = '_principal'")
  plays       = run_sql("SELECT name, title FROM plays")  # SELECT content WHERE name=? on demand

  # Carry-forward: agent decides how far back to read for the
  # matters in scope. Dynamic, not a fixed window.
  available = run_sql("SELECT DISTINCT diary_date FROM diary_components ORDER BY diary_date DESC")
  for d in agent_decides_which_to_read(available, matters_in_scope):
    past = run_sql("SELECT * FROM diary_components WHERE diary_date = ?", [d])
    # Note unresolved components, dismissed items, principal notes.

  # Identify the matters that belong in today's diary.
  surfacing_candidates = []
  for s in run_sql("SELECT id FROM subjects WHERE subject_kind='anchor' ORDER BY last_active DESC"):
    a = run_sql("SELECT * FROM anchors WHERE id = ?", [s.id])
    score = surfacing_score(a, principal, plays, today)
    if score > 0:
      surfacing_candidates.append((a, score))

  # Compose components, section by section. Each component is persisted
  # by the typed tool for its template (write_email_draft_inline,
  # write_calendar_block_decision, write_choose_one_cards, …), which
  # validates the content against that template's schema before writing.
  clear_diary(today)   # idempotent recompose
  for (anchor, score) in rank(surfacing_candidates):
    components = compose_for_anchor(anchor)
    for cmp in components:
      if cmp.dispatchable:
        # Two-pass draft+validate.
        draft = produce_draft(cmp, anchor)
        # Validation reaches into the source via MCP — fetch the
        # original thread or doc, check claims against it.
        if validate_against_source(draft):  # MCP read
          write_<template>(date=today, section=..., headline=..., content=draft,
                           actions=[...], anchor_ids=[anchor.id])
          emit_efference_prediction(anchor.id, prediction_spec={
            "kind": "event",
            "claim": cmp.efference_claim,
            "expected_by": cmp.expected_by,
            "precision": cmp.efference_precision,
            "source_dispatchable": cmp.id,
          })
        else:
          write_diary_prose_note(date=today, section="tracking", ...)  # demoted: validation failed
      else:
        write_<template>(date=today, ...)   # non-dispatchable component

    if newly_recognized_entity_drives_components(...):
      # diary agent cannot promote; flag the case in the thinking layer
      # for the next mind invocation to act on
      append_thinking_layer(today, [f"promotion candidate: {entity_id} — appearing across {n} components"])

  # Pattern signals not tied to a single anchor → their own components.
  for pattern in cross_anchor_patterns():
    write_<template>(date=today, ...)

  append_thinking_layer(today, agent_journal_note(surfacing_candidates))
```

The diary agent reads broadly and reasons deeply. This is where the reasoning budget is spent.

**Two-pass draft.** Single-pass drafting produces fluent text that may be confidently wrong about a fact in the source thread. The agent's draft+validate flow blocks approval when any concrete claim is ungrounded; after one revision attempt, an unapproved draft demotes to a Tracking note ("the agent wanted to draft this but could not ground a claim cleanly"), which is itself useful signal. The two passes are two LLM-call exchanges inside the agent loop, not separate agents. Validation reaches into the source via MCP — the agent reads the actual email thread or calendar event, not a stored copy.

**No drain step.** The diary agent does not drain anything. By the time it fires, all pending events have already been processed by mind-agent invocations — that's the dispatcher pair's responsibility (next section).

## Always-fresh: how it's enforced

The diary agent must compose over fresh state. The mechanism, in the Electron main process:

1. The **mind dispatcher** is a durable, serialized event-bus subscriber. It pulls one event off its internal queue at a time, spawns a Claude Code subprocess, awaits exit, then advances. One event finishes processing before the next starts.
2. When a diary trigger arrives (`schedule.diary_tick` from the diary scheduler, or `digest_run` from the surface MCP), the **diary dispatcher** does not spawn the diary agent until the mind dispatcher's queue is empty and no mind invocation is in flight.
3. Specifically: any event received **before** the diary-trigger timestamp has been dispatched to and processed by a mind-agent subprocess before the diary-agent subprocess spawns.
4. Then the diary dispatcher spawns the diary agent.

Same semantic as the prior framing (compose over fresh state), different mechanism (in-process dispatcher serialization on the event bus). No stream queue. No `processed` flag. No drain step inside the diary agent.

The principal does not see a stale diary; they see a fresh one shortly later. The `digest_run` MCP call blocks until the diary is ready.

See [08-runtime.md](08-runtime.md) and [11-backend-architecture.md](11-backend-architecture.md) for the dispatcher implementations and event-bus durability.

## Cold-start agent

**Fires:** once at `digest init`, and rarely thereafter.

**Goal:** seed the initial substrate from `profile.md` **and** the principal's recent observable history — so the first weeks of mind/diary work don't have to re-derive what history already answers.

> **Note — this supersedes the original "principal-anchor only, no backfill" design.** The first cut had cold-start seed *only* the principal-anchor and let everything else emerge from live events. It now performs a bounded first-pass: it scans a 7–30 day window of inbox / calendar / notes and seeds the principal anchor **plus** a capped set of high-conviction anchors, long-tail entities, `_principal` relationships, visible-cadence predictions, reminders for time-anchored matters, and a small library of persona plays. The "empty Day 1, organic emergence" framing below is gone; the mechanism (lazy, event-driven runtime *after* seeding) is unchanged.

The cold-start agent **does** query historical data — that is the point. It reads the profile via `read_profile` and surveys history via the role's email / calendar / notes MCPs (live + point-in-time reads; no separate "history" server).

**Tool surface (allowlist):** the **full mind write surface** (`create_anchor`, `update_anchor_layer`, `create_entity`, `promote_entity`, `create_relationship`, `update_relationship_layer`, `create_prediction`, the precision family, `cite`, `set_reminder`, …) read through `run_sql` + the file readers, **plus `create_play`** (cold-start-only — for deriving persona plays). Plus the role's history MCPs.

**Typical sequence:**

```
cold_start_agent():
  profile = read_profile()
  history = survey via email/calendar/notes MCPs over a 7–30 day window

  # Principal anchor — slow layer from profile (verbatim voice) + observed patterns, precision ~0.70
  create_anchor({id: "_principal", display_name, kind: "person", identity_handles})
  update_anchor_layer({id: "_principal", layer: "slow", content, precision: 0.70, source_ids})

  # High-conviction anchors (≤15): people/projects/orgs where ambiguity is gone
  for subject in overwhelming_evidence(history):
    create_anchor({display_name, kind, identity_handles}); update_anchor_layer(...)
    create_relationship({subject_id: "_principal", target_id}); update_relationship_layer(...)

  # Long-tail entities (≤40): one+ mention, below the anchor bar
  for subject in long_tail(history):
    create_entity({display_name, kind_hint, identity_handles}); cite(...)

  # Visible cadences (≤10) and time-anchored matters
  for cadence in clean_signals(history): create_prediction({anchor_id, kind, claim, precision: 0.5..0.7})
  for deadline in dated_commitments(history): set_reminder({fires_at, context, anchor_ids})

  # Persona plays (~8–15): how THIS principal handles recurring moments,
  # derived from real examples (read howto:* seed plays first as worked examples)
  for pattern in recurring_handling(history): create_play({name, title, content, derived_from})
  # Done. Exit.
```

After cold-start exits, the main process opens the gates (webhook server, tunnel, schedulers). As events arrive, the mind dispatcher updates the seeded substrate; the first diary tick composes over it. A typical run makes 250–400 small tool calls; that volume is expected.

The cold-start dispatcher also subscribes to `profile.changed` (emitted by the profile mtime watcher). If `profile.md` is edited later, cold-start re-fires to re-seed the principal-anchor's authored content while preserving observation-derived deltas.

Cold-start is idempotent: it checks the `subjects` view before creating, so a re-run over the same inputs does not duplicate or clobber.

## Lazy time-handling

There is no clock running cognitive bookkeeping. Three implications:

**Predictions are evaluated when the agent runs.** A prediction's `expected_by` marks when the agent should *consider* the prediction; nothing fires automatically. The next mind-agent invocation that touches the prediction's anchor (because a new event activated it), or the diary agent during composition, reads predictions and rules on them.

**Activation decay is computed on read.** Anchors store `activation` and `last_bumped`. When the diary agent reads an anchor to score for surfacing, it computes `effective_activation = activation * exp(-decay_rate * days_since_last_bumped)`. No background sweep writes decayed values.

**Reminders are real events.** The mind agent's `set_reminder` inserts a `reminders` row. The reminder scheduler maintains a sleep-until-fire timer queue sorted by `fires_at`. When a reminder fires, the scheduler emits `reminder.fired` on the bus; the mind dispatcher picks it up and spawns a mind invocation with the reminder as input — same as any other event. This is the only mechanism by which the cognitive layer schedules its own future thinking.

The discipline: **don't simulate time; let events drive work, and process each as it arrives.** Lazy evaluation pairs cleanly with event-driven dispatch — both refuse to do work nobody asked for.

## The execution lane (task events → Claude Code execution → outcome events)

Cognition produces artifacts. **Execution against the world is not the digest agent's job.** When the principal acts on a HITL component in the diary, a separate Claude Code subprocess executes; the digest agents observe the outcome through ordinary events.

**Trigger:** the renderer's action buttons (or the surface MCP's `diary_act`) emit `task.fired` on the bus, carrying `{ task_id, component_id, diary_date, action, principal_input, context_pointers }`. See [02-diary-model.md](02-diary-model.md#action-affordances-and-the-execution-boundary).

**Spawn:** the **execution dispatcher** subscribes to `task.fired`. It builds an execution-agent system prompt ("you are the executor for a digest task; here's the component, the principal's chosen action, the input, the source pointers; execute and report") and an MCP config listing the external MCP servers needed for the action (gmail-mcp for emails, gcal-mcp for calendar, …). **No substrate MCP** is included — execution instances cannot read or write the cognitive layer.

**Execution:** the spawned Claude Code subprocess runs permissionless. It uses the external MCP servers' tools (send email, accept invite, open doc, post message, …). It runs to completion.

**Outcome:** on exit, the execution dispatcher emits one of:

- `task.completed` — success. The dispatcher also updates the originating `diary_components` row's `status` to `acted` and the renderer's diary view draws the marginalia "acted" glyph on the component.
- `task.failed` — error. Status stays `open`; the failure becomes an observation for the mind agent to react to (typically by adjusting the component's rationale on the next diary tick).

**Feedback to cognition:** both `task.completed` and `task.failed` are durable bus events that flow into the mind dispatcher (it subscribes to them like any other observation). A mind invocation fires; the relevant anchor's case base gains a `case_base_entries` row citing the outcome; the efference prediction tied to the component (via `predictions.source_dispatchable`) is supported or contradicted accordingly via the standard precision arithmetic.

**External canonicality.** The world is still the canonical record. The execution dispatcher's outcome event is a fast internal signal; the external observation (the recipient's reply lands as a Gmail webhook; the attendee's accept-decline shows up as a calendar webhook) is the ground truth that arrives through normal event ingestion later. The two are consistent in steady state; if they diverge — `task.completed` said success but no reply arrives in the expected window — the mind agent navigates the conflict via its usual precision arithmetic.

## Coordination

Each agent invocation reads state from the substrate, processes via MCP tool calls, exits.

**Serialization.** The mind dispatcher ensures mind-agent invocations run one at a time. The diary agent runs alone, after pending mind-agent work has completed. No two diary-agent invocations run concurrently — an on-demand `digest_run` arriving while another diary is composing queues with a short bounded wait, then errors. Execution-instance invocations are **not** serialized — multiple `task.fired` events can spawn concurrent Claude Code subprocesses (different recipients, independent actions). Their outcomes feed back into the serialized mind queue.

**Dedup.** The webhook server maintains a small in-memory cache of recent event IDs (no payloads). An event arriving with an ID the cache has seen is dropped silently. Cache size is bounded and ages out quickly — meant for retry storms and webhook redelivery, not long-term history.

**Idempotency.** Anchor and entity updates are content-addressed via the agent's last-write-wins discipline. Prediction rulings move precision once per evidence event; the mind agent reasons about whether a new event is the same evidence it's already seen (rare, but possible). Diary writes overwrite today's file in place.

**State is always on disk.** No in-memory caches survive an agent invocation. A crashed invocation leaves the substrate in its last committed state; the next invocation re-reads from disk and proceeds.

## Invariants

- **Yesterday's diary is immutable.** Once the principal's clock has crossed midnight, no agent or tool writes to the previous day's file. `diary_add_comment` and `diary_add_note` against yesterday's diary error and offer to land on today's instead.
- **Principal-anchor is the only anchor whose content is seeded from `profile.md`.** Cold-start also seeds other anchors and entities, but from *observed history*, not the profile. After cold-start, new anchors enter via mind-agent action — `create_anchor` for first-sight commitment or `promote_entity` after evidence accumulates. Profile mtime changes flow only into the principal-anchor.
- **Diary agent cannot write the substrate.** `create_anchor`, `create_entity`, `promote_entity`, `delete_entity`, the precision family, and every `update_*` substrate tool are off its allowlist. Composition reads the substrate; substrate change is the mind agent's job.
- **A diary-agent invocation is always preceded by pending events being processed.** The diary dispatcher enforces this; no agent code asserts it.
- **The digest agents have no execution tools.** Sending email, accepting invites, opening docs — all live in spawned Claude Code execution instances, never in mind / diary / cold-start. Outcomes return via `task.completed` / `task.failed` events.
- **All Anthropic invocations are permissionless.** Mind, diary, cold-start, and execution all run with `--dangerously-skip-permissions`. Discipline lives in MCP tool catalogs and prompts, not in runtime gates.
- **Case base entries cite source IDs.** Never inline copies of email bodies, calendar payloads, or note contents. When the agent wants evidence, it calls MCP.
- **No execution.** No agent sends email, accepts invites, or marks tasks done. Outputs are files. Execution lives in the calling agent; the digest learns the outcome through the next round of events.

## On-demand vs scheduled

Same code path; the differences are operational.

- **Scheduled** fires from the diary scheduler subsystem at times in `config.jsonc`'s `diary_times`. The scheduler is naive; the diary dispatcher's always-fresh wait handles serialization.
- **On-demand** fires from the surface MCP's `digest_run`. The tool blocks until the diary dispatcher finishes pending mind work and the diary-agent subprocess completes, then returns the assembled diary JSON.

Both produce a populated set of `diary_*` rows for today. See [03a-agent-shape.md](03a-agent-shape.md) for MCP tool schemas, [08-runtime.md](08-runtime.md) for the dispatcher hosting, and [11-backend-architecture.md](11-backend-architecture.md) for the process model.
