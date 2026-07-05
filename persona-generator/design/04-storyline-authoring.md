# Storyline-First Authoring

Digest items are *declared* at Stage 5, not *derived* later. This doc covers the object hierarchy, lifecycle vocabulary, noise events with temporal effects, why Stage 7 has no plot authority, and how Stage 9 becomes a deterministic walk.

## The shift

Earlier iterations treated digest items as downstream artifacts — Stage 7 plants emails and meetings, Stage 9 reads them and infers what should surface. That model accumulated special cases:

- **Silence signals** — something that *didn't* happen needs a digest item.
- **Time-shifted items** — a Day-8 reschedule moves a Day-13 IC's "day-of" item to Day-16.
- **Pattern shifts** — three consecutive minor support pings means something.
- **Anomalies.**

Inferring all of these reliably from artifacts after the fact is brittle. The cleaner architecture: **storylines are the source of truth, and both digest items and artifacts are co-authored as children of the storyline.** Digest items are the primary entity; artifacts are evidence for them.

## Object hierarchy

```
Storyline                                  (authored at Stage 5)
├── narrative arc (prose)
├── declared digest moments
│   ├── digest_moment_A
│   │   ├── target_morning: Day N
│   │   ├── section / priority / action_class
│   │   ├── rationale (prose)
│   │   └── supporting_artifacts: [artifact_id_1, ...]
│   └── digest_moment_B
├── noise events (each with effects on the moments above)
│   └── noise_event_1
│       ├── occurrence_date: Day K
│       ├── triggers_artifact: artifact_id_N
│       └── effects: [SHIFTED moment_A to Day N+3,
│                     CANCELED moment_B,
│                     DECLARED new moment_C at Day K+1, ...]
│              each effect with its own effective_from: Day K or later
└── planned artifacts
    └── artifact_id, target_render_date, kind, content_sketch
```

Every artifact in the `emails` / `notes` / `calendar_ops` tables corresponds to at least one declared moment's `moment_supporting_artifacts` link — or is explicitly flagged as a decoy on its `planned_artifacts` row (suppression target).

**Where these objects live.** Stage 5's structured tools (`add_storyline`, `declare_digest_moment`, `declare_noise_event`, `declare_planned_artifact`) INSERT into the matching tables in `persona.db` (`storylines`, `declared_moments`, `noise_events` + `noise_effects`, `planned_artifacts`). The narrative arc prose stays in `internal/storylines/<id>/arc.md`. See [10-storage.md](10-storage.md).

## Lifecycle vocabulary for declared moments

| State | Meaning | Set by |
|---|---|---|
| `DECLARED` | Initial state when authored at Stage 5 | Stage 5 |
| `CANCELED` | A noise event invalidated this moment; Stage 9 excludes it | Noise effect |
| `SHIFTED` | Same content, new `target_morning` (old entry CANCELED, new DECLARED entry exists at new date) | Noise effect |
| `MODIFIED` | Same target_morning, updated rationale / priority / action_class | Noise effect |

## Noise events carry temporal effects

Each noise event declares:

- `occurrence_date` — when it happens in the persona's world.
- `triggers_artifact_id` — the artifact it produces (the reschedule email, the engineer-resigns email).
- `effects[]` — a list of lifecycle modifications to other declared moments, each with its own `effective_from` so cascades can span multiple days cleanly.

### Worked example

A Day-8 reschedule of a Day-13 IC declares three effects in a single noise event:

- `SHIFTED moment_marcus_ic_dayof from Day 13 → Day 16` (`effective_from: Day 8`)
- `SHIFTED moment_marcus_prep from Day 12 → Day 15` (`effective_from: Day 8`)
- `DECLARED new moment_accept_new_slot at Day 9` (`effective_from: Day 8`)

All three are authored together at Stage 5. The Day-16 ideal digest's `lifecycle_history[]` for `moment_marcus_ic_dayof` carries full provenance back to the Day-8 noise event: original declaration on Day 0, shifted on Day 8, emitted on Day 16. No inference required.

## Stage 7 has no plot authority

Once storylines + plans + noise events are authored at Stage 5, Stage 7 becomes pure rendering. Each day's agent:

- **Renders** today's pre-declared artifacts in persona voice. The artifact_id, kind, recipients, and target date are fixed at Stage 5; the agent supplies the prose body in the right tonal zone.
- **Writes** activity_log + daily_state describing the persona's experience of the day — interiority, mood, what was noticed. These are interiority documents, not plot decisions.
- **May inject texture noise** — small ambient details (a slack ping, a 12-minute meeting overrun) that don't touch any declared digest moment.

It cannot:

- Invent a noise event.
- Cancel or modify a moment.
- Decide what tomorrow's digest should contain.
- Add planted artifacts beyond the pre-declared list.

Plot authority is reserved to Stage 5. Stage 7 is voice + interiority.

State propagation still happens — each day reads prior day's narrative state document. The narrative IS the cascade: Day N+1's voice references Day N's state by name. The cascade is narrative continuity, not plot decision-making.

## Stage 9 becomes a deterministic walk

Because every digest item is pre-declared and lifecycle-tracked, Stage 9's per-morning extraction collapses to a single SQL query — no per-morning Python loop, no LLM:

```sql
-- conceptual shape; the real query handles SHIFTED chains
SELECT
    m.moment_id,
    m.storyline_id,
    COALESCE(latest.new_target_morning, m.target_morning) AS target_morning,
    COALESCE(latest.new_priority, m.priority)             AS priority,
    COALESCE(corr.corrected_rationale, m.rationale)       AS rationale,
    v.status
FROM declared_moments m
LEFT JOIN (
    -- latest effect with effective_from ≤ M, per moment
    SELECT target_moment_id, ...
    FROM noise_effects
    WHERE effective_from <= :morning
) latest                 ON latest.target_moment_id = m.moment_id
LEFT JOIN validation_log v   ON v.moment_id = m.moment_id
LEFT JOIN validation_log corr ON corr.moment_id = m.moment_id AND corr.status = 'correct'
WHERE COALESCE(latest.new_lifecycle, m.initial_lifecycle) = 'DECLARED'
  AND COALESCE(latest.new_target_morning, m.target_morning) = :morning
  AND v.status IN ('pass', 'correct');
```

No LLM judgment per morning. No inference. Declarative ground truth in SQL. See [08-validation-and-assembly.md](08-validation-and-assembly.md) for what the validation pass adds and [10-storage.md](10-storage.md) for the table shapes.

## Density expectations for a 35-day window

The substantive shift, not just a number bump:

- **5–10 storylines per persona** — multiple parallel arcs, not one monolithic raise. Each has 8–20 declared moments and 3–7 noise events.
- **Phased long-running arcs.** A raise isn't a single storyline; it's outreach → first meetings → diligence rounds → IC → term sheet → close, with each phase having its own beats. Across 35 days the raise passes through 2–3 phases.
- **Mid-window emergence.** Not every storyline introduces itself on Day 1. A new investor reaches out Day 14; an engineer gives notice Day 22; a regulatory inquiry lands Day 28.
- **Mid-window resolution.** Some arcs close within the window (positively or negatively) — a hire signs Day 9, a customer escalation closes Day 17, an evaluation concludes Day 22. An eval window where nothing ends feels stagnant.
- **Short micro-arcs coexist with long arcs.** 5–10 day arcs that start and resolve mid-window live alongside arcs that span the full 35 days.
- **Periodic events** — monthly board update, biweekly 1:1 cadence, weekly all-hands — become storyline beats and accumulate context.

The richness compounds: by Day 20, the persona carries multiple half-resolved arcs, several closed ones leaving emotional residue, and 2–3 new ones still unfolding. That's what makes Day 20's morning digest meaningfully different from Day 8's. That's what makes eval interesting.

## What this earns

- **Time-shifted items become arithmetic**, not narrative gymnastics. Reschedules, cancellations, and modifications all flow through `effective_from`.
- **Silence signals are first-class.** A `DECLARED` moment with no supporting artifact is exactly the case where something didn't happen by today and matters.
- **Full provenance.** Every emitted digest item traces back: declared at Stage 5, modified by noise events, validated at 9a, emitted at 9b. The `lifecycle_history[]` field carries the chain.
- **Cross-storyline interactions** (a noise event from storyline A affecting storyline B's moments) are allowed and reconciled at Stage 6.

The artifact-first model could express each of these only by stacking inference rules. The storyline-first model expresses them by design.
