# Eval

This doc specifies how the trial grades whether the digest is good: a golden test case against the Avery Chen fixture, a rubric of items the digest must surface, must suppress, and must flag as patterns, and a grading methodology combining manual review with LLM-as-judge against the produced diary JSON.

## The challenge

"Good digest" is per-user. Goodness composes from universal principles, the principal's `profile.md`, and the learned principal-anchor (see [00](00-architecture-overview.md)). A digest good for Avery (founder mid-raise) would be wrong for a different principal.

The architecture is general; the trial ships a specific fixture. The rubric is concrete enough to grade — anchored in Avery's data, profile, suppressions — while exercising the architectural mechanisms the general system depends on. Each item maps to a mechanism; the rubric is evidence the architecture is doing what it claims.

## The golden test case

The assignment PDF includes a sample digest for **Thursday, May 21, 2026** (Avery Chen, pages 4–6 of the brief). This is the gold standard: what the tool should produce when run against Avery's synthetic data with Avery's `profile.md` at 6:00am Pacific on May 21, 2026.

The sample is not a literal target — wording will differ, ordering may vary, component specs may use slightly different fields — but it specifies the cognitive coverage the produced diary must achieve.

## The graded artifact: diary JSON

Eval reads the produced diary JSON file at `~/digest/diary/2026-05-21.json`. Rubric items map to:

- Components in `sections.right_now` and `sections.on_the_desk` for must-surface action items.
- Components in `sections.tracking` for must-flag-as-pattern items.
- Absence of components for must-suppress items (no component anywhere in the four sections; absent from `notes` too).
- `thinking_layer` entries for the honesty signal (the agent's reasoning trace).
- Component `efference_prediction` precision values for the honesty calibration check.

This shift from markdown sections to JSON components makes the eval mechanical: a check is `find a component with type X in section Y referencing anchor Z`.

## The rubric

Three parts: items the tool **must surface**, items it **must suppress**, items it **must flag as patterns**. Each item names the source signal and the mechanism it exercises.

### Must surface — `right_now` & `on_the_desk`

**Marcus Webb cap-table promise.** Avery promised the updated cap table Tuesday night; it is now Thursday morning. Second slip on the same commitment to the lead investor. The top item: an `email-draft` component with the cap-table file referenced in the draft body (cited via its source id).

> *Mechanism:* principal-anchor P0 weighting on Series A + `event` prediction contradicted ("Avery sends cap table v3 by Tuesday EOD") + cross-entry pattern (second slip) surfaced as `pattern` prediction on the slow layer.

**Mei Tanaka offer letter in DocuSign for 48h.** Tomás and Jordan signed off Monday. Mei's competing offer expires Friday. Surface as a `diary-prose.flash` (urgent heads-up citing the DocuSign link), or a `choose-one` if there's a real sign / hold / renegotiate decision to force.

> *Mechanism:* profile-declared P1 hiring loop + sharp `event` prediction with `expected_by` = Friday + entity-to-anchor promotion of Mei.

**Diane Okafor Q1 board update 11 days overdue.** Last update Feb 8; monthly cadence is Avery's commitment, recorded in `board-update-cadence.md`. Diane hasn't asked. Signal is note-only — no email triggered this; contradiction lives between a note saying "monthly" and 11 days of inbox silence (verified via SDK-native MCP query on the sent-folder).

> *Mechanism:* cross-source detection (note observation + inbox absence) + `pattern` prediction (cadence) contradicted + agent's judgment to surface despite no inbound prompt.

**Renee Tan at Halberd asking yes/no on May 28 rollout.** Internal stakeholder meeting is tomorrow; she needs EOD answer. Jordan confirmed Tuesday engineering is on track. Answer is yes. Surface as `email-draft`.

> *Mechanism:* customer-P1 anchor + sharp `expected_by` window + cross-anchor synthesis (Renee's question + Jordan's standup = drafted reply).

**David Kim at Aperture Capital quiet 21 days.** Active raise; Avery owned the next step ("let's talk soon," April 30). 21 days is past every plausible event-prediction window.

> *Mechanism:* `event` prediction whose `expected_by` long passed; agent's rule (contradict-and-delete or surface) → surface-and-delete, with the relationship-fast layer's precision dropped.

**Sam's "Wren — pediatrician 3:00pm" calendar conflict.** Sam added it to the shared calendar at 21:04 the previous night. Overlaps the 2:30pm Q2 planning sync. Avery's profile is explicit: family items P0; Sam-related must be surfaced (not drafted for).

> *Mechanism:* principal-anchor family-P0 weighting on Sam + cross-source contradiction (work calendar vs shared calendar) + suppress-the-draft rule from profile → `choose-one` or `free-text-reply`, not `email-draft`.

**Three expense reports awaiting approval.** Submitted Monday, blocking team payouts. Easy to drop. Surface as `choose-one` (approve / decline / triage).

> *Mechanism:* profile-declared "easy to drop but blocking" pattern + agent-prepared structured choice.

**Lumen Analytics demo agenda choice at 10:30am.** Rep is waiting on agenda choice: standard or API-focused. Team's evaluation hinges on ingestion + backfill; recommend API-focused. Surface as `choose-one` with three options.

> *Mechanism:* `choose-one` component + cross-anchor synthesis (rep's question + team needs = recommended pick).

### Must surface — `tracking` (pattern signals)

These items must surface as **patterns**, not as actions. Surfacing an action when only a pattern is warranted is a failure — the architecture must distinguish "this is moving" from "this needs you now."

**Northstar Foods reply cadence slowed from 1.2 days to 4.8 days.** Two-week window. No support tickets open. Could be noise; could be early churn signal.

> *Mechanism:* per-anchor reply-latency `pattern` prediction; new observations contradict the prior baseline; relationship-fast layer's precision drops; diary surfaces as Tracking, not Right Now.

**Veritas Components renewal moved to "next quarter" again.** Second slip. Tomás logged it Tuesday but did not escalate.

> *Mechanism:* across-anchor anomaly (Veritas's slow-layer claim "renews on schedule" contradicted twice) + relationship-slow precision drop; diary surfaces with the loop-detection framing.

**Designer hiring loop stalled 7 days.** No candidate movement. Tomás owns next step.

> *Mechanism:* hiring-loop play + `event` prediction (candidate movement by date) contradicted + last-owner identification.

**OpenRouter announced volume pricing on DeepSeek-V4 Pro.** ~30% lower, effective June 1. Relevant to inference-cost line in the Series A model.

> *Mechanism:* low-precision-but-still-relevant surfacing tied to Series A anchor mid-layer mentioning inference cost as a Marcus diligence topic.

**MX Manufacturing AI Summit case studies by Halberd and Northstar that did not name Tessera.** Could be MSA constraint, could be positioning miss. Worth asking Renee casually when replying.

> *Mechanism:* cross-anchor pattern (two reference customers, same event, common absence) + folded into the existing `email-draft` to Renee.

### Must suppress

The diary must not surface these. Failures here are more serious than missing a must-surface item — the architectural commitment to "honest cognition, not fabricated certainty" depends on suppression discipline.

- **Newsletters.** Profile is explicit: "ignore newsletters." A newsletter in the digest is a profile-suppression failure.
- **Marketing emails from SaaS tools.** Same rule.
- **Calendar invites already accepted.** Avery has a calendar app; restating is noise.
- **Long threads where Avery had the last word and nobody replied.** The thread is on the other party's side of the court.
- **FYI-only items.** No action implied, no decision pending. Profile suppression.
- **Individual recruiter cold emails.** Single instances are noise. The exception below applies.

### Must flag as patterns

- **Three or more recruiter emails from the same firm in a week.** Surfaces in `tracking` as a `diary-prose.note` with the framing "three messages from Sequoia Recruiting this week — worth a one-line response or a block-sender." Not as an action.

> *Mechanism:* `pattern` prediction emerges from the recruiter entity's mention rate + profile-aware exception layer overriding default suppression.

## Items the architecture is silent on

Several items in the sample digest (Tomás's Northstar forward, Q2 planning doc with two open comments, EU AI Act guidance) are valid surfacing but do not exercise a sharp mechanism. The rubric does not require them by name; presence/absence is graded on judgment.

## Mechanism mapping

Every must-surface item maps to one or more mechanisms. Each mechanism rests on **source-ID-cited evidence** — case-base entries point at `gmail:<msg-id>`, `gcal:<event-uid>`, `notion:<page-id>`, etc., so the eval harness can verify the agent's reads against the seeded data. Audit trail:

| Eval item | Mechanism(s) |
|---|---|
| Marcus cap-table top item | Principal-anchor P0 + `event` prediction contradicted + second-slip detected as `pattern` |
| David Kim 21 days quiet | `event` prediction past `expected_by` with no support, no contradict → agent surfaces and deletes; relationship-fast precision dropped |
| Diane Q1 update overdue | Cross-source detection (note + inbox absence) + cadence `pattern` prediction contradicted |
| Sam pediatrician conflict | Principal-anchor family-P0 + cross-source contradiction (work cal vs shared cal) + suppress-the-draft → non-`email-draft` component |
| Northstar slowdown pattern | Per-anchor reply-latency `pattern` prediction contradicted → flag as pattern in `tracking` |
| Veritas second slip | Across-anchor anomaly + relationship-slow precision drop |
| Recruiter suppression | Profile suppression + `pattern` prediction emerges from mention rate |
| Lumen agenda choice | `choose-one` + cross-anchor synthesis (rep + team needs) |
| Mei DocuSign 48h | Profile P1 hiring + sharp `event` `expected_by` (Friday) + entity-to-anchor promotion |
| Renee Halberd yes/no | Customer-P1 anchor + cross-anchor synthesis (Renee + Jordan) → `email-draft` |
| Expense approvals | Profile "easy to drop but blocking" + `choose-one` |
| OpenRouter pricing | Low-precision-but-relevant surfacing tied to Series A mid-layer |
| MX Summit absence | Cross-anchor pattern + folded into the existing Renee `email-draft` |

Two sources disagreeing about Marcus's meeting day (calendar says Friday, email says Monday — a seeded conflict in Avery's data) tests **agent resolves contradiction via `thinking_layer` entry** rather than picking one and hiding the other. The "honesty contract" from Avery's profile operationalized.

## Relationship-layer arithmetic in eval

Several rubric items implicate the per-layer relationship precision arithmetic (see [01-anchor-model.md](01-anchor-model.md)). These are graded by inspecting anchor state alongside the diary:

- **Northstar slowdown.** The `Northstar` anchor's `rel_to_northstar_pattern` relationship has a fast-layer claim about reply latency. After the slowdown window, this layer's precision should have **dropped** (contradict applied multiple times). Eval check: read the Northstar anchor; assert `relationships[*].fast.precision < relationships[*].fast.precision_at_T0`.
- **Marcus cap-table contradiction.** The `event` prediction's precision should be `<= 0.05 * 0.30` from initial. Eval check: read the Marcus anchor; assert the prediction has either been deleted (irrelevant) or has precision below initial.
- **Veritas second slip.** Slow-layer relationship claim ("renews on schedule") should have dropped twice. Eval check: precision delta visible across the two-tick window.

## Grading methodology

Three complementary methods, each fast enough to run on every produced diary.

### Manual review

Read the produced diary against the rubric. Score must-surface coverage (items present / total), must-suppress discipline (zero failures expected), must-flag-as-pattern correctness (items in `tracking` vs `right_now`).

For the trial, the reviewer is the design author. In production, the principal plays this role — they read the diary and know whether it covered the day. Manual review is slow but high-fidelity; ground truth for calibrating the other methods.

### LLM-as-judge

A separate Claude call receives the rubric plus the produced diary **JSON** and returns pass/fail per item with reasoning. The prompt is structured so the judge does not see the PDF's sample digest — it grades on rubric semantics, not literal text match.

```
You are grading a daily digest against a rubric. The digest is a JSON object
with sections (right_now, on_the_desk, tracking, background), each holding
typed components. For each rubric item, determine whether the produced
diary surfaces, suppresses, or flags-as-pattern as required. Inspect
components by type, section, anchor_refs, content, and (where present)
efference_prediction. Return a JSON object with per-item verdicts.
```

Cheap, semi-objective, reproducible. The method that scales as the tool iterates.

### Diff against the sample digest

A separate Claude call receives the produced diary JSON and the PDF sample, returns a structured comparison: which items appear in both, which appear only in produced, which appear only in sample, and coverage percentage.

Weaker signal than the rubric grade (the sample is one realization of "good for Avery on May 21," not the only one), but catches large omissions the rubric might miss.

## Passing tiers

Each tier corresponds to a level of coverage; failing a lower tier means later tiers are not evaluated.

- **Smoke.** Tool runs to completion without errors. Produces a valid diary JSON at `~/digest/diary/2026-05-21.json` matching the schema in [02-diary-model.md](02-diary-model.md).
- **Coverage.** Diary surfaces at least **80% of must-surface items** (counted by item, not character match). Items in the sample's Right Now / Urgent sections map to components in any `right_now` or `on_the_desk` slot of the produced; pattern items map to `tracking`.
- **Discipline.** Diary suppresses **100% of must-suppress items**. Any failure is graded more seriously than missing one must-surface item. Discipline is binary because the commitment to suppression is binary — the principal told the tool to ignore newsletters; a newsletter in the digest erodes trust in the artifact.
- **Honesty.** Items with low underlying precision are surfaced with appropriate hedging. The `efference_prediction.precision` field is calibrated: a `precision: 0.80` draft should be the kind the principal sends without edits >80% of the time. Uniform-confidence prose across heterogeneous evidence is a failure. Northstar slowdown surfaced with explicit uncertainty about churn vs noise is the canonical pass.
- **Tone.** Drafted replies match Avery's voice: lowercase greetings, ≤3 sentences, no chirpy adjectives, no "circling back," no "I hope this email finds you well." The diary agent's validate-pass catches tone violations; surviving violations indicate prompt failure. Graded by LLM judge against `profile.md` voice rules.

A diary passing Smoke + Coverage + Discipline + Honesty + Tone is a pass for the trial.

## Trial scope vs production scope

The rubric is for the one-week trial against Avery. Production eval extends in four directions:

1. **Multi-user.** Run against diverse profiles; grade each against its own rubric.
2. **Longitudinal.** Does precision-weighted updating converge or drift? Does principal-anchor divergence from `profile.md` accumulate productively? Are entity promotions calibrated?
3. **Principal feedback loop.** Engagement is signal; a component repeatedly carried forward without action is a candidate for suppression.
4. **Cost and latency.** Per-invocation token consumption; end-to-end latency.

Out of scope for the trial; natural next steps.

## Designed-in test cases

The rubric items are deliberately seeded in Avery's synthetic data so the eval exercises the mechanisms. Collusion in the right way: the data is designed to test specific cognitive claims, not to be lifelike at all costs.

A second-slip on the Marcus cap table requires two prior commitment events cited in the anchor's case base. The Diane Q1 overdue signal requires `board-update-cadence.md` declaring monthly plus a long enough gap in the sent-folder (queryable via Gmail MCP). The Northstar slowdown requires a reply-latency distribution that visibly shifts within the synthetic data's window. Each mechanism in the rubric maps to a data-generation requirement.

The persona generator is not value-neutral. It generates data with intent — exercising the cognitive system's claims. Eval and data generation are co-designed for this trial. See `persona-generator/design/` for the data side.
