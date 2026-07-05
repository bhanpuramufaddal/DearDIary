# Validation and Assembly (Stage 9)

Stage 9 produces the eval ground truth. Two internal phases:

- **9a Validation** — parallel-per-moment LLM agents. The substantive work.
- **9b Assembly** — deterministic walk, no LLM. Bookkeeping that emits the per-morning JSON files.

These were originally separate stages (8.5 + 9). The assembly half is pure temporal arithmetic over declared moments and the validation log — it doesn't deserve peer status with validation. Folding both into Stage 9 reflects the cognitive weight honestly: validation is the substance, assembly is materialization.

## Why validation matters

The storyline-first declarative model is expressive but not self-checking. Errors creep in through:

- **Cascade incoherence** — multiple noise effects leaving a moment in an inconsistent state.
- **Cross-storyline contradictions** — two active moments at the same morning contradict each other.
- **Obsolescence** — Stage 7's rendering shows the persona already took the action; the moment is moot.
- **Rationale drift** — text written on Day 0 references events that didn't happen as planned.
- **Authority misalignment** — a declared moment doesn't fit the persona's character or judgment.

Phase 9a is the verification-easier-than-generation insight applied: it's much easier to check whether a candidate digest item makes sense given a fully-resolved past than to author it correctly upstream.

## Phase 9a — Validation

The orchestrator queries `persona.db` for every declared digest moment whose final lifecycle state (after applying all rows in `noise_effects` with `effective_from ≤ target_morning`) is `DECLARED` and whose `target_morning` falls in the eval window. For each surviving moment:

1. **Spawn a validation agent** — one per moment, fanned out in parallel by the LangGraph subgraph.
2. **The agent reads the persona's complete past as of morning M**:
   - All emails / notes / calendar state with timestamps ≤ end-of-day-(M-1) (via the service emulator's REST/MCP, or direct DB queries scoped by date)
   - `daily_state/day_(M-1).md`
   - `character_sketch.md` and `judgment.md` (as reference)
   - The full content of every supporting artifact for this moment (looked up via `moment_supporting_artifacts` → `emails` / `notes`)
3. **The agent answers ONE narrow question**: given this past, is this declared moment still internally consistent?
4. **It emits exactly one of:**
   - `validation_pass(moment_id, brief_justification)`
   - `validation_fail(moment_id, reason, severity)` — phase 9b will exclude this item
   - `validation_correct(moment_id, corrected_rationale, corrected_priority_if_any, justification)` — item stands with a minor correction
5. **Each tool INSERTs a row into `validation_log`** (PRIMARY KEY `moment_id`).

**Tools.** `Read`, `Glob` + `validation_pass`, `validation_fail`, `validation_correct` (each INSERTs into `validation_log`; see [10-storage.md](10-storage.md)).

With ~80–150 active moments per persona, phase 9a is the heaviest LLM workload after Stage 7.

### What the validator checks

1. **Coherence** — does the rationale align with the supporting artifacts' actual content?
2. **Currency** — has subsequent state made this obsolete? (e.g., the cap-table action was already taken in artifact d09.)
3. **Cross-item consistency** — does this contradict another active moment at the same morning?
4. **Persona fit** — given the character sketch + judgment essay, would this persona actually care about this on this morning?
5. **Cascade integrity** — after all lifecycle effects applied, does the final state make narrative sense?

The validator does *not* re-judge digest quality in some general sense. It checks **internal consistency with the now-known past**. Failure modes are narrow and verifiable: obsolescence, contradiction, rationale-references-events-that-didn't-happen.

It also does *not* re-author moments or second-guess Stage 5's narrative choices. If a Stage-5 decision was eccentric but coherent, the validator passes it. If it was incoherent given what later actually happened, the validator fails or corrects it.

## Phase 9b — Assembly

A single SQL query joining `declared_moments` ⋈ lifecycle-resolved `noise_effects` ⋈ `validation_log`, partitioned by morning, projected into the JSON output. No per-morning Python loop, no LLM. Pseudo-shape:

```sql
-- one execution per morning M in Days 6–35
SELECT
    m.moment_id,
    m.storyline_id,
    m.section,
    COALESCE(latest.new_target_morning, m.target_morning) AS target_morning,
    COALESCE(latest.new_priority, m.priority)             AS priority,
    COALESCE(corr.corrected_rationale, m.rationale)       AS rationale,
    v.status                                              AS validation_status
FROM declared_moments m
LEFT JOIN (
    -- the latest applicable effect per moment, with effective_from ≤ :M
    SELECT target_moment_id,
           new_target_morning, new_priority, new_rationale, effect_kind AS new_lifecycle
    FROM noise_effects
    WHERE effective_from <= :M
    -- partition by target_moment_id, order by effective_from DESC, pick first
) latest                  ON latest.target_moment_id = m.moment_id
LEFT JOIN validation_log v    ON v.moment_id = m.moment_id
LEFT JOIN validation_log corr ON corr.moment_id = m.moment_id AND corr.status = 'correct'
WHERE COALESCE(latest.new_lifecycle, m.initial_lifecycle) = 'DECLARED'
  AND COALESCE(latest.new_target_morning, m.target_morning) = :M
  AND v.status IN ('pass', 'correct')
ORDER BY priority;
```

The orchestrator runs this 30 times (once per morning M ∈ Days 6–35), then serializes each result set with full lifecycle history (computed from `noise_effects` rows) to `ideal_digests/morning_NN.json`. Per-morning runs are independent and can be parallelized for speed.

A thin LLM call can optionally produce `morning_NN.reasoning.md` for human inspection (narrative explanation of which moments surfaced and why). The structured JSON output is fully deterministic regardless.

### Schema for `ideal_digests/morning_NN.json`

Every field traces to its source plan + validation log entry. Full provenance from authored moment → cascade-modified moment → validated moment → emitted item:

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

Each item points to:

- Its source storyline plan — where it was declared.
- Its lifecycle history — what happened to it across the cascade, with `from_date` and the noise event responsible for each transition.
- Its validation log entry — when it was checked, what was found.

### Why Days 6–35 only

Day 1 morning has no accumulated state — no carryovers, no stalled threads, no drift. The digest would be trivial. By starting eval on Day 6, every morning faces ≥ 5 days of realistic accumulation, which is what production digests always face.

## What Phase 9 explicitly does NOT do

- Re-author moments.
- Re-judge digest quality in some general sense.
- Read artifacts to infer what should surface (digest items are declared, not inferred — see [storyline authoring](04-storyline-authoring.md)).
- Apply LLM judgment per morning at assembly time.
- Second-guess Stage 5's narrative choices.

The cognitive boundary is sharp: 9a checks the validity of pre-declared moments against now-known facts. 9b walks the validated set and emits files. Nothing more.

## Verification that this stage is working

A few load-bearing checks:

- **Every active moment is validated.** For each persona, count `declared_moments` whose final state (after applying all `noise_effects` with `effective_from ≤ target_morning`) is `DECLARED` and whose `target_morning` is in Days 6–35. The row count in `validation_log` must equal that count. No active moment is unvalidated.
- **Assembly honors the log.** Every item in `ideal_digests/morning_NN.json` has `validation_status ∈ {pass, correct}`. No `fail` item appears. `correct` items show their `corrected_rationale` in the emitted `rationale` field.
- **Non-zero failure rate.** Across all 5 personas, the global `validation_fail` rate is non-zero. Pure passes everywhere would suggest the validator is rubber-stamping. Spot-check 3 failed entries: each `reason` describes a real coherence / currency / contradiction issue.
- **Lifecycle cascade integrity.** For a chosen noise event in one storyline, trace its `effects[]` against the affected moments' `lifecycle_history[]` in the emitted ideal digests. Each declared effect appears as a corresponding lifecycle entry on the right moment, with `from_date == noise.effective_from`. No effect silently dropped; no lifecycle entry without a triggering effect.
