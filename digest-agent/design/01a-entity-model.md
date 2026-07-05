# The Entity Model

The **entity** is the provisional cousin of the anchor. An entity is a subject the mind agent has noticed but has not committed to. Entities are cheap to create, easy to discard, and explicit about their tentative status.

This doc specifies the entity schema, how entities are discovered, how they accumulate evidence, how the mind agent promotes them to anchors, and why entity-to-entity edges are deliberately not supported. The anchor schema is in [01-anchor-model.md](01-anchor-model.md). Shared sub-schemas (`case_base_entry`, `relationship_object`, `precision_arithmetic`) are defined in [03a-agent-shape.md#shared-schemas](03a-agent-shape.md#shared-schemas).

## Entity vs anchor

|  | Entity | Anchor |
|---|---|---|
| Status | Provisional | Committed |
| Created by | Mind or cold-start agent (`create_entity`) | Mind or cold-start agent — directly (`create_anchor`) or via promotion (`promote_entity`); `_principal` seeded by cold-start from `profile.md` |
| Storage | Row in `entities` (+ `nodes`, `case_base_entries`, `relationships`) | Row in `anchors` (+ `nodes`, `case_base_entries`, `relationships`, `predictions`, `prediction_layer_bindings`) |
| Layers | None (flat schema with prose `notes`) | Three timescale layers |
| Predictions | None | Yes |
| Relationships | Outbound to anchors only | To other anchors |
| Read by | Mind agent (for updates + promotion), diary agent (for composition) | Every agent |
| Surfaced to principal | Not directly; the diary may reference entity-derived observations | Yes |

The entity primitive exists so the mind agent can be agile. When a new subject appears, the agent doesn't need to decide if it's worth a full anchor commitment — it creates an entity, attaches whatever it noticed, and moves on. The agent may later promote that entity once evidence has accumulated, or — on rare high-conviction observations — it may skip the entity step and create an anchor directly. Both creation paths and the promotion path are the mind agent's calls.

**Most new subjects enter as entities and graduate by promotion.** Cold-start seeds the principal-anchor and nothing else. Direct `create_anchor` exists for the narrow case of a first-sight observation that already justifies commitment (a term sheet from a brand-new investor, a P0 invite from someone profile.md names explicitly). When in doubt, create an entity; the agent will revisit on the next event that touches it.

## Schema

One row per entity in the `entities` table of `~/digest/digest.db` (plus a parent row in `nodes`). Case-base citations live in `case_base_entries` rows with `layer = NULL`; relationships in the `relationships` table with `subject_id = <entity_id>` and `target_id` always an anchor.

The JSON document below is the **agent-visible shape** — what `read_entity(id)` returns and what `create_entity(spec)` accepts. The storage layer reassembles it from rows on read and decomposes back on write. See [11-backend-architecture.md](11-backend-architecture.md#schema-ddl) for the table definitions.

```json
{
  "id": "sarah_chen",
  "kind": "person",
  "first_seen": "2026-05-12T11:04-08:00",
  "last_seen":  "2026-05-22T16:30-08:00",
  "mention_count": 4,

  "identity_handles": ["Sarah Chen", "sarah@inflectionpoint.vc"],

  "notes": "Associate at Inflection Point Ventures working under Marcus on the Series A diligence. First appeared cc'd on Marcus's April 19 reply; has shown up on every cap-table thread since. Drafting style is methodical — full sentences, numbered questions. Probably runs the diligence checklist day-to-day.",

  "case_base": [
    {"source_id": "gmail:CAG5152a@mail.gmail.com", "date": "2026-05-12", "note": "cc'd on cap-table v1 reply"},
    {"source_id": "gmail:CAH8b2c1@mail.gmail.com", "date": "2026-05-15", "note": "first direct question on option pool"},
    {"source_id": "gmail:CAJaa771@mail.gmail.com", "date": "2026-05-19", "note": "follow-up on 409A timing"},
    {"source_id": "gmail:CAKc4489@mail.gmail.com", "date": "2026-05-22", "note": "ack on cap-table v3"}
  ],

  "relationships": [
    {
      "id": "rel_to_marcus_webb",
      "target": "anchor:marcus_webb",
      "slow": {"claim": "Works under Marcus on this round", "precision": 0.78},
      "mid":  {"claim": "Running the day-to-day diligence checklist", "precision": 0.65},
      "fast": {"claim": "Pinging Marcus's threads same-day", "precision": 0.55}
    },
    {
      "id": "rel_to_series_a_round",
      "target": "anchor:series_a_round",
      "slow": {"claim": "Diligence-side counterpart on Tessera's round", "precision": 0.70},
      "mid":  {"claim": "Owning open cap-table questions", "precision": 0.60},
      "fast": {"claim": "Quiet 24h after acking v3", "precision": 0.50}
    }
  ]
}
```

Field-by-field:

- `id` — primary key in `nodes` and `entities`. Stable across promotion: when this entity becomes an anchor, the same id moves to the `anchors` table (the parent `nodes` row's `kind` flips). Because `relationships.subject_id` and `relationships.target_id` FK against `nodes.id`, every edge keeps resolving.
- `kind` — free-form string. The mind agent invents kinds as needed (`person`, `vendor`, `team`, `topic`, `loose-thread`). Not a class; just a hint.
- `identity_handles` — fast-path strings. Same role and discipline as on anchors (see [01-anchor-model.md](01-anchor-model.md)).
- `first_seen` / `last_seen` — bookends on observation.
- `mention_count` — incremented every time the mind agent attaches a new edge or new case-base entry. Used as a proxy at promotion time.
- `notes` — free-form prose. The mind agent's running summary of what is known about this subject. The flat alternative to slow/mid/fast: one paragraph, freely rewritten.
- `case_base` — array of `case_base_entry`. Same shape as on anchor layers (see [03a-agent-shape.md#case_base_entry](03a-agent-shape.md#case_base_entry)).
- `relationships` — array of `relationship_object` ([03a-agent-shape.md#relationship_object](03a-agent-shape.md#relationship_object)) with the constraint that `target` is always `anchor:<id>`.

No predictions field. Entities cannot carry standing predictions. Once a subject is worth predicting against, it is worth committing to as an anchor.

## Relationships

Relationships on an entity use the same `relationship_object` shape as on anchors. The mind agent updates layers independently via `update_relationship_layer`; the precision arithmetic is the shared `precision_arithmetic` rule.

**`target` is always an anchor.** Entity-to-entity relationships are not supported. Two reasons:

1. **Tractability.** The entity store is cheap precisely because it doesn't form a graph with itself. Mind-agent updates touch one entity at a time, drawing edges only to committed anchors. The committed substrate is the graph.
2. **Promotion clarity.** When an entity becomes an anchor, its outbound edges port over verbatim. If entities could point at each other, promoting one would force decisions about partially-formed edges into half-promoted territory.

If two entities are clearly related, the agent's job is to decide whether either belongs as an anchor. If yes, promote it and connect. If no, neither edge matters yet.

## Discovery

The mind agent creates entities when events arrive. When an event references a subject that doesn't match any existing anchor or entity, the agent creates a new entity. The minimum bar: a name or address worth remembering; one piece of observed content; one edge if the subject was observed in relation to a known anchor.

The cold-start agent also creates entities — it runs `create_entity` (and `create_anchor` / `promote_entity`) over a 7–30 day history scan to seed the long tail at onboarding (capped at ≤40 entities), so the substrate isn't empty on Day 1. After that one-time pass, entities accrue through the mind agent as events arrive via webhooks. When an agent needs historical context for an emerging subject, it queries the corresponding source via SDK-native MCP access (e.g., search Gmail for prior threads).

The mind agent's first decision per new subject is `create_entity` vs `create_anchor`. Default to entity. Reach for `create_anchor` only when the triggering event already carries enough weight to justify commitment without observation — see the guidance in [03a-agent-shape.md](03a-agent-shape.md).

## Edges and mention count

Every new edge or case-base entry the mind agent attaches **bumps `mention_count`**. The count is a single integer the agent reads as one proxy among many when deciding whether to promote.

The proxies the mind agent weighs at promotion time:

- `mention_count` — has this subject kept appearing?
- Edge density — how many anchors does this entity relate to? An entity with edges to Marcus + Series A is more central than one with a single edge.
- Edge layer precision — high-precision slow edges suggest the relationship is well-understood.
- Principal-anchor signals — does the principal's profile or principal-anchor slow layer mark this kind of subject as important?
- Recency of `last_seen` — a stale entity is a candidate for deletion, not promotion.

None of these are gates. Two well-cited mentions over a critical week may merit promotion; ten mentions of a peripheral cc may not.

## Promotion to anchor

The mind agent decides — typically on the same invocation that just touched the entity, while the freshest evidence is in context. Promotion happens via `promote_entity`, which atomically:

1. Reads the entity row (and its `case_base_entries`, `relationships`).
2. Writes a row in `anchors` with the **same id**; flips the parent `nodes` row's `kind` from `entity` to `anchor`.
3. Writes `notes` into the new anchor's **slow_content** at a starting precision the agent chooses (typically 0.50–0.65 — the notes were never claim-tested individually).
4. Rewrites the `case_base_entries` rows so `layer = 'slow'` on the now-anchor (entries' source IDs and notes carry over unchanged).
5. Initializes mid and fast layer columns from the agent's best read of the current state (with low precision; these are inferred, not observed).
6. The `relationships` rows already FK against the node id; they continue to resolve without rewriting.
7. Deletes the `entities` row.

Same id is the key invariant. Any relationship in the substrate that pointed at `anchor:sarah_chen` continues to resolve — even if it was created when `sarah_chen` was still an entity, since the target prefix is always `anchor:` (validated at relationship-creation time; an entity becomes promotable only when its referrers are willing to commit to `anchor:` prefix).

> **Edge case.** If the mind agent creates an edge to a not-yet-existing anchor target (because it expected promotion soon), the edge resolves once the entity is promoted. Until then, the target is dangling; the agent's tool layer can either reject the create or accept it as a pending edge — see [03a-agent-shape.md](03a-agent-shape.md).

The mind agent seeds standing predictions on the new anchor in the same invocation, while the evidence that justified promotion is still in context.

## What the diary agent does when it notices

The diary agent composes the day's JSON and may notice mid-composition that an entity is quietly underpinning multiple items — Sarah Chen's questions are driving three different diary components — and seems to deserve anchorhood. The diary agent **cannot promote**. Substrate ownership stays with the mind agent.

What the diary agent does instead: compose the diary referencing the entity as-is, and note the observation in the day's `thinking_layer`. The next mind-agent invocation reads recent diary thinking-layer notes as part of its context and decides whether to promote. The lag is bounded by event cadence; in practice, the next inbound event re-runs the mind agent within minutes.

The shape suggests a useful pattern: when in doubt, leave a subject as an entity. The mind agent will resolve the doubt the next time evidence touches it.

## Deletion

The mind agent may decide an entity is no longer worth tracking — stale, peripheral, or wrongly created. The `delete_entity` tool deletes the `entities` row (and, via `ON DELETE CASCADE`, the parent `nodes` row, its `case_base_entries`, and any incoming/outgoing `relationships`). Stale-sweep happens during ordinary mind invocations: when the agent touches an entity it doesn't recognize as still relevant, it can clean up.

The diary agent cannot delete entities. If it sees a stale entity during composition, it leaves a thinking-layer note for the next mind invocation.

## What entities are not

Listed by negation because the distinction is load-bearing:

- **Not a queue.** Entities don't represent "things to process." Inbound events trigger the mind agent directly.
- **Not a cache.** Entities are durable judgment, however provisional. They survive across mind-agent invocations.
- **Not a tag system.** An entity is a subject the agent might think about again. A tag is a property attached to other content.
- **Not a half-anchor.** An entity has no layers. Promoting an entity to an anchor is not "filling in the missing layers"; it's a deliberate commitment that this subject merits the full model.

## How entities feed the diary

The diary agent reads entities at composition time to:

1. **Find ambient context.** An entity may carry a useful observation worth noting in the diary even without promotion: "Sarah Chen is now the day-to-day diligence contact on Series A; you've been replying to Marcus on these threads but Sarah is the one waiting."
2. **Detect cross-anchor patterns.** Two entities pointing at the same anchor may reveal a structural read the agent should surface.
3. **Flag promotion candidates** in the thinking layer for the next mind invocation.

Entities are part of the substrate, not the diary. They live behind the Inspector window (or `digest inspect <entity_id>` from the CLI) for human inspection. Most days the principal never knows they exist.
