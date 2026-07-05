# The Anchor Model

The **anchor** is the system's committed cognitive primitive: one structured file per durable subject (a person, a project, a deal, an ongoing matter).

This doc specifies the schema, the three-layer semantics, predictions (event / fact / pattern), layered relationships, identity handles as fast-path hints, activation, and the principal-anchor's special role. The provisional cousin of the anchor — the **entity** — is specified in [01a-entity-model.md](01a-entity-model.md).

Sub-schemas referenced here — `layer_object`, `relationship_object`, `prediction_object`, `case_base_entry`, `precision_arithmetic` — are defined once in [03a-agent-shape.md#shared-schemas](03a-agent-shape.md#shared-schemas). This doc shows the anchor in context; it does not redefine the sub-shapes.

See `diagrams/anchor-entity-graph.excalidraw` for a graph view of an anchor alongside an adjacent entity.

## What an anchor is

One row per subject in the `anchors` table of `~/digest/digest.db` (plus a parent row in `nodes` for graph-edge resolution; see [11-backend-architecture.md](11-backend-architecture.md) for the schema). A subject is anything durable enough to think about across days. The schema is identical for every anchor — there is no class hierarchy. A person-anchor differs from a project-anchor only in what its layers contain, what handles it matches, and what predictions it carries. Real subjects refuse classes: Marcus Webb is also "the lead on the Series A round."

The JSON document below is the **agent-visible shape** — what a `run_sql` read of an anchor (joined with its `case_base_entries`, `relationships`, `predictions`) assembles into, and the conceptual shape `create_anchor` / `update_anchor_layer` build up. The storage layer holds it across `anchors`, `case_base_entries`, `relationships`, `predictions`, and `prediction_layer_bindings` rows; the agent reads via SQL and writes via the typed tools.

## File format

```json
{
  "id": "marcus_webb",
  "kind": "person",
  "display_name": "Marcus Webb",
  "created_at": "2026-03-12T09:14:22-08:00",
  "activation": 0.74,
  "last_bumped": "2026-05-23T17:42:00-08:00",

  "identity_handles": [
    "Marcus Webb",
    "Marcus",
    "marcus@inflectionpoint.vc",
    "mwebb@inflectionpoint.vc"
  ],

  "slow": {
    "precision": 0.78,
    "content": "Lead partner at Inflection Point Ventures. Came up through enterprise SaaS, has led three Series A rounds in the last eighteen months. Decision-style is consultative-but-decisive. Cares about cap-table cleanliness more than valuation; has walked from rounds over secondary structure. Prefers written follow-ups. Reachable evenings PT; partner meetings Tuesdays.",
    "case_base": [
      {"source_id": "gmail:CABx7y8z@mail.gmail.com", "date": "2026-03-12", "note": "intro from Jordan; first meeting requested"},
      {"source_id": "gmail:CADd1pQk@mail.gmail.com", "date": "2026-04-02", "note": "asked for clean cap table"},
      {"source_id": "gmail:CAEa3vMx@mail.gmail.com", "date": "2026-04-19", "note": "walked from competitor's round over secondary"}
    ]
  },

  "mid": {
    "precision": 0.62,
    "content": "Round is in late-diligence. Cap table is the remaining gate; partner meeting Tuesday May 26 is the decision point. Tempo over the past three weeks is steady — replies within 24h. Counter-terms email most likely next move after partner meeting if it goes well; polite stall if it doesn't.",
    "case_base": [
      {"source_id": "gcal:9f2k1aabc@google.com", "date": "2026-05-10", "note": "partner meeting confirmed"},
      {"source_id": "gmail:CAFn8tWp@mail.gmail.com", "date": "2026-05-21", "note": "acknowledged cap table v3 received"}
    ]
  },

  "fast": {
    "precision": 0.55,
    "content": "Cap table v3 sent Thursday May 21; Marcus acknowledged same day with \"will review before Tuesday.\" No reply since. Quiet for 48h is within his normal range; quiet past Monday afternoon would not be.",
    "case_base": [
      {"source_id": "gmail:CAFn8tWp@mail.gmail.com", "date": "2026-05-21", "note": "acknowledged cap table v3"}
    ]
  },

  "relationships": [
    {
      "id": "rel_to_inflection_point",
      "target": "anchor:inflection_point_ventures",
      "slow": {"claim": "Partner; not a fly-by", "precision": 0.85},
      "mid":  {"claim": "Inflection is leading the round in his name", "precision": 0.72},
      "fast": {"claim": "No firm-level signal this week", "precision": 0.50}
    },
    {
      "id": "rel_to_series_a_round",
      "target": "anchor:series_a_round",
      "slow": {"claim": "Lead investor", "precision": 0.90},
      "mid":  {"claim": "Driving timing; partner meeting is his call", "precision": 0.78},
      "fast": {"claim": "Holding cap-table review; no other open asks", "precision": 0.60}
    },
    {
      "id": "rel_to_jordan_park",
      "target": "anchor:jordan_park",
      "slow": {"claim": "Introduced by Jordan; warm tie", "precision": 0.80},
      "mid":  {"claim": "Jordan still useful for back-channel reads", "precision": 0.55},
      "fast": {"claim": "—", "precision": 0.50}
    }
  ],

  "predictions": [
    {
      "id": "pred_2026-05-21_001",
      "kind": "event",
      "claim": "Marcus replies with substantive questions or a green light before the May 26 partner meeting",
      "expected_by": "2026-05-26T09:00-08:00",
      "based_on": ["mid", "fast"],
      "precision": 0.62,
      "created_at": "2026-05-21T17:00-08:00"
    },
    {
      "id": "pred_2026-04-02_007",
      "kind": "fact",
      "claim": "Marcus prefers written follow-ups over verbal commitments",
      "based_on": ["slow"],
      "precision": 0.78,
      "created_at": "2026-04-02T11:14-08:00"
    },
    {
      "id": "pred_2026-05-10_004",
      "kind": "pattern",
      "claim": "Marcus replies inside 24h on weekdays during active diligence",
      "based_on": ["mid"],
      "precision": 0.70,
      "created_at": "2026-05-10T13:00-08:00"
    },
    {
      "id": "efference_2026-05-23_018",
      "kind": "event",
      "claim": "Marcus replies within 48h with counter-terms or green light",
      "expected_by": "2026-05-25T17:00-08:00",
      "based_on": ["mid"],
      "precision": 0.65,
      "source_dispatchable": "diary/2026-05-23#act_007",
      "created_at": "2026-05-23T18:30-08:00"
    }
  ],

  "notes": "Highest-stakes active thread. Slow layer well-supported; fast layer leans on a single acknowledgment and should not be over-read."
}
```

Field roles at a glance:

| Field | Purpose |
|---|---|
| `id` | Filename stem. Stable across the anchor's life. |
| `kind` | Descriptive hint (`person`, `project`, `deal`); not a class. |
| `display_name` | Human-readable name for the renderer. |
| `created_at` | When the anchor was committed. |
| `activation`, `last_bumped` | Lazy decay surfacing signal. See "Activation and surfacing" below. |
| `identity_handles` | Fast-path matching hints. The agent decides actual matches; see "Identity handles" below. |
| `slow` / `mid` / `fast` | The three timescale layers. Each is a `layer_object`. |
| `relationships` | Array of `relationship_object`. |
| `predictions` | Array of `prediction_object`. |
| `notes` | Optional free-form prose the agent writes for itself. |

## The three timescale layers

Each anchor carries three `layer_object` layers, ordered by how fast their content turns over:

- **Slow** — the durable model. Who they are, how they decide, what they have walked away from. Changes on the scale of weeks to months. Survives a quiet month.
- **Mid** — the current state of the matter. Where the deal is, what the open thread is, what the next likely move is. Turns over on the scale of days to two weeks.
- **Fast** — the last 24–72 hours. Quiet-since timestamps. Most-recent acknowledgments. Updated nearly every time the anchor is touched.

Layers relate by **promotion and demotion** in the agent's reasoning: new observation lands in fast; if it persists, the mind agent rewrites it into mid; if a mid claim survives weeks, it filters to slow. Slow claims that observation steadily disconfirms get rewritten downward, with disconfirmation logged in the case base.

A layer's `content` is **prose, not structured fields.** "Marcus prefers written follow-ups to verbal commitments" names a falsifiable pattern. `prefers_written: true` loses the qualifier and the case base's grip.

## Case base

Every layer's `case_base` is an array of `case_base_entry` — citations into source IDs. *A pattern without its cases is a slogan.* The mind agent adds entries when it rewrites a layer; entries are pruned only when their supporting claim is removed.

Full `case_base_entry` shape and source-ID conventions: [03a-agent-shape.md#case_base_entry](03a-agent-shape.md#case_base_entry).

## Precision arithmetic

Each layer carries explicit `precision` in `[0.05, 0.95]`. Precision is calibration on the whole layer's content, not confidence in a single fact. A slow layer at `0.78` would survive most adversarial questioning; a fast layer at `0.55` is plausible but readily revisable.

Precision moves only when the mind agent rules on a prediction (or on a relationship layer). The arithmetic — support adds, contradict subtracts, irrelevant deletes — is the same wherever precision lives, and is specified once in [03a-agent-shape.md#precision_arithmetic](03a-agent-shape.md#precision_arithmetic).

There is no clock-driven "expired" outcome. A prediction's `expected_by` simply marks when the agent should check; if the window has passed and no evidence exists either way, the agent decides whether the question is still worth asking. If it isn't: delete.

## Predictions

A **prediction** is a falsifiable claim the agent commits to. The full `prediction_object` shape — fields, conditional `expected_by`, `based_on` cascade, `source_dispatchable` — is in [03a-agent-shape.md#prediction_object](03a-agent-shape.md#prediction_object).

Three kinds:

- **`event`** — something will happen by a time. Carries `expected_by`. Example in the Marcus record: "Marcus replies with substantive questions or a green light before the May 26 partner meeting."
- **`fact`** — something is true. No `expected_by`. Standing belief; any new observation can support or contradict. Example: "Marcus prefers written follow-ups over verbal commitments."
- **`pattern`** — something tends to happen. Distributional. Precision tracks how reliable the pattern is. Example: "Marcus replies inside 24h on weekdays during active diligence."

Efference-copy predictions are ordinary `event` predictions with `source_dispatchable` set to a diary component ref. The diary agent emits these when it surfaces dispatchable components — the world's response (or non-response) feeds back through normal event processing, the mind agent rules on it like any other prediction.

**Discipline: don't over-predict.** A prediction must be sharp enough to be wrong. "Marcus will continue to be a productive lead" is not a prediction. "Marcus will reply with substantive questions or a green light before Tuesday" is. The case base of supporting evidence is the test.

## Layered relationships

Relationships between anchors (and from entities to anchors) are `relationship_object` — three layers (slow / mid / fast), each `{claim, precision}`, updated independently. Full shape in [03a-agent-shape.md#relationship_object](03a-agent-shape.md#relationship_object).

The semantics mirror anchor layers: slow holds the durable kind of relationship; mid the current state; fast the last day's posture. A new observation may support the slow claim (Marcus is still the lead) while contradicting the fast (he just asked for a side conversation outside cap-table review).

`target` is always `anchor:<id>`. Relationship targets are always committed anchors. **Entity-to-entity relationships are not supported** — see [01a-entity-model.md](01a-entity-model.md) for the reasoning.

Relationships are not bidirectional by storage. Marcus's `rel_to_series_a_round` does not require the round's anchor to mirror it. The agent traverses one-way edges during composition.

## Identity handles

`identity_handles` is an array of strings — names, addresses, slugs, code names — that **hint** at when this anchor might be relevant. They are *fast-path proxies*, not match rules.

The mind agent reads handles during event processing as a first-pass scan but **decides actual matches itself** by reading the event's content against the anchor's slow and mid layers. A direct address-match is usually right; a name-match may not be. The agent prunes false-positive handles and adds aliases as they appear.

Person-anchor handles: names, nicknames, email addresses across domains. Project-anchor: code name, channel name, document slug. Deal-anchor: company name, round name, common phrasings.

## Activation and surfacing

Each anchor carries `activation` in `[0, ∞)`. The mind agent increments activation when it judges an event to be about the anchor; `last_bumped` updates.

Activation **decay is computed lazily** — there is no clock to apply decay every tick. When the diary agent (or any agent that needs activation) reads an anchor, it computes the current activation as `activation * exp(-decay_rate * days_since_last_bumped)`. Decay rate ships at `0.05`. No write happens on the read; activation is materialized as a function of the file's stored value plus elapsed time.

The diary agent uses activation as one signal among many when deciding what to surface; it is not a gate. A quiet anchor with a sharp upcoming prediction window may surface above a noisy one.

## Where anchors come from

Anchors enter at two moments: a one-time **cold-start** seeding pass, and then through the **mind agent** for the life of the system. The previous threshold-based emergence rule is gone — the mind agent decides per event, with the freshest evidence in context, whether a new subject merits an entity, a direct anchor, or no commitment at all, and later promotes an entity once evidence accumulates.

- **Cold-start agent** does a bounded first-pass over the principal's 7–30 day history: the principal-anchor (content seeded from `profile.md`), plus a capped set of high-conviction anchors (≤15), long-tail entities (≤40), relationships, predictions, and reminders — all derived from *observed* history. It uses the same `create_anchor` / `create_entity` / `promote_entity` tools as the mind agent (plus `create_play`). This replaced the original "principal-anchor only, organic emergence from Day 1" design.
- **Mind agent** owns anchor creation and promotion thereafter. On each event it may: create an entity (default, provisional), create an anchor directly (rare, high-conviction first sight), or promote an existing entity whose evidence has accumulated. Mention count, edges, and direct principal engagement are signals it weighs, not gates it must pass.
- **Diary agent** holds no substrate-write tools — it does not create or promote. If composition reveals an entity that ought to be an anchor, the diary agent notes it in the day's thinking layer; the next mind invocation acts.

When an agent needs historical context for a subject (e.g., the last ten emails from Marcus), it queries the corresponding source via SDK-native MCP access.

The diary agent's allowlist excludes `create_anchor` and `promote_entity`; only the mind and cold-start agents hold them. See [01a-entity-model.md](01a-entity-model.md) for entities and the promotion mechanics, and [03a-agent-shape.md](03a-agent-shape.md) for the entity-vs-anchor judgment call at creation time.

## The principal-anchor

One anchor is structurally identical to every other but functionally privileged: the **principal-anchor**, about the principal themselves. It lives at `id = '_principal'` in the `anchors` table (the underscore marks it visually; schema is unchanged).

Four things make it special:

1. **Seeded from `profile.md` at cold-start.** The principal's declared self-description becomes the initial slow layer with high precision (content is self-declared). Identity handles get the principal's name and email addresses.
2. **Default prior for new anchors and entities.** When the mind agent creates a new entity or anchor, the principal-anchor's voice and priors pass as defaults: "this is who the principal is, this is how they write, this is what they care about." New subjects start not from zero.
3. **The richest record.** Slow layer most-cited, case base deepest, predictions longest-lived. Every diary tick reads it. Most mind-agent updates reference it.
4. **Its slow layer may diverge from `profile.md`, and that divergence is content.** `profile.md` is the durable seed; it does not auto-update. As observation accumulates, the principal-anchor may begin to disagree — principal said "ignore newsletters" but reads them carefully. When the divergence is well-cited, the diary surfaces it honestly. The architecture refuses to silently override the profile or to maintain a private model that contradicts it.

**On `profile.md` change.** The runtime watches the file's mtime. On change, the cold-start agent re-seeds the principal-anchor's seeded content while preserving observation-derived content where it doesn't conflict with the new declaration.

## Render-to-prose

Anchors are SQLite rows internally, JSON on the agent-visible boundary, prose on demand for inspection. The Inspector window renders the anchor in journal-prose form; `digest inspect <anchor_id>` is the CLI equivalent. The SQLite rows are the source of truth.

## How anchors feed the diary

The diary agent reads anchors as the substrate for composition. Sections are populated by traversing anchors with high activation, near-window predictions, or principal-anchor priors that elevate them. Every dispatchable component carries `anchor_refs` back into this layer; the efference prediction lives in the referenced anchor. The diary is the speech; the anchors are the mind.

See [02-diary-model.md](02-diary-model.md) for the diary side and [03-cycle.md](03-cycle.md) for the agent invocations that update both.
