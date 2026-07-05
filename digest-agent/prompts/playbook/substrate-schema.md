# Substrate schema (read reference for `run_sql`)

The substrate is the cognitive mind-model, a SQLite DB. This doc is the
schema reference for **reads** — the tables you can `SELECT` from via
`run_sql`. The *concepts* (anchor vs entity, slow/mid/fast, precision,
case_base, predictions) are in the disposition's "Mental model" section
— read that first if unsure.

**Reads** — `run_sql({ sql, params? })` — SELECT / WITH / PRAGMA / EXPLAIN.
The connection is read-only at the server boundary for every role; mutations
throw. Use bound `params` (positional `?` with an array, or named `:x`/`$x`/`@x`
with an object) — never string-concatenate.

**Writes** — typed per-resource tools. Each does one operation atomically;
the server handles IDs, FK ordering, JSON manipulation, and precision
arithmetic. See `tools/list` (or the agent prompt's tool allowlist) for the
full surface. Naming: `create_*`, `update_*`, `delete_*`, `bump_*`, plus
`promote_entity`, `cite`, `update_identity_handles`, `set_reminder` /
`cancel_reminder`, and the `support_*_precision` / `contradict_*_precision`
family (one tool per target: anchor / relationship / prediction).

## Tables (mind model)

### nodes — every anchor and entity is a node first
```
id          TEXT PRIMARY KEY      -- e.g. '_principal', 'marcus_webb'  (kebab/underscore, leading letter or '_')
kind        TEXT  CHECK (kind IN ('anchor','entity'))
created_at  TEXT                  -- ISO 8601
```
`anchors.id` and `entities.id` FK against `nodes.id`. Deleting a node CASCADEs
to its anchor/entity, relationships, predictions, case_base, reminder refs.

### anchors — high-conviction subjects with layered belief
```
id                TEXT PRIMARY KEY REFERENCES nodes(id)
display_name      TEXT
kind              TEXT NOT NULL DEFAULT 'subject'   -- person/company/investor/customer/initiative/event/...
activation        REAL NOT NULL DEFAULT 0
last_bumped       TEXT NOT NULL                     -- ISO 8601; updated by bump_anchor / update_anchor_layer
identity_handles  TEXT NOT NULL DEFAULT '[]'        -- JSON array of strings (emails, names, aliases)
slow_content      TEXT   slow_precision   REAL      -- identity / nature; precision in [0.05, 0.95]
mid_content       TEXT   mid_precision    REAL      -- current state across weeks
fast_content      TEXT   fast_precision   REAL      -- what's true right now / today
notes             TEXT
```

### entities — provisional subjects (promote to anchor when evidence accrues)
```
id               TEXT PRIMARY KEY REFERENCES nodes(id)
kind_hint        TEXT
first_seen       TEXT NOT NULL    last_seen TEXT NOT NULL    -- ISO 8601
mention_count    INTEGER NOT NULL DEFAULT 1
identity_handles TEXT NOT NULL DEFAULT '[]'
notes            TEXT
```

### relationships — directed claim from a node to an ANCHOR
```
id          TEXT PRIMARY KEY    -- 'rel_…' (server-generated)
subject_id  TEXT REFERENCES nodes(id)     -- usually '_principal'
target_id   TEXT REFERENCES anchors(id)   -- TRIGGER enforces this is an anchor
slow_claim TEXT  slow_precision REAL  |  mid_claim … | fast_claim …
UNIQUE (subject_id, target_id)
```
A trigger ABORTs if `target_id` is not an anchor. One relationship per
(subject, target) pair. (The `create_relationship` tool pre-checks the
target-is-anchor rule for a clearer error than the trigger.)

### predictions — forward-looking claims about an anchor
```
id                  TEXT PRIMARY KEY    -- 'pred_…' (server-generated)
anchor_id           TEXT REFERENCES anchors(id)
kind                TEXT CHECK (kind IN ('event','fact','pattern'))
claim               TEXT NOT NULL
expected_by         TEXT      -- REQUIRED iff kind='event'; MUST be NULL otherwise (CHECK enforced)
precision           REAL NOT NULL    -- [0.05, 0.95]
created_at          TEXT NOT NULL
source_dispatchable TEXT      -- e.g. 'diary/2026-05-21#cmp_id' for efference predictions
```
`prediction_layer_bindings(prediction_id, anchor_id, layer)` records which
anchor layers ground a prediction (layer ∈ slow/mid/fast).

### case_base_entries — evidence grounding a layer's content
```
id        TEXT PRIMARY KEY    -- 'cb_…' (server-generated)
node_id   TEXT REFERENCES nodes(id)
layer     TEXT CHECK (layer IN ('slow','mid','fast') OR NULL)
source_id TEXT NOT NULL    -- the real artifact id, e.g. 'gmail:<msg-id>' / a persona source_id
date      TEXT NOT NULL
note      TEXT
position  INTEGER NOT NULL DEFAULT 0
```
"No layer content without case_base" is enforced at the tool layer — both
`update_anchor_layer` and `promote_entity` require non-empty `source_ids`,
so ungrounded layer writes are structurally impossible.

### reminders — time-anchored prompts
```
id        TEXT PK            -- 'rem_…' (server-generated)
fires_at  TEXT NOT NULL      -- ISO 8601 with offset
context   TEXT NOT NULL
set_by    TEXT CHECK (set_by IN ('mind_agent','diary_agent'))
set_at    TEXT NOT NULL      fired_at TEXT
```
Linked to anchors via `reminder_anchor_refs(reminder_id, anchor_id)`. Both
rows are inserted atomically by `set_reminder`.

### plays — the few-shot precedent library
```
name         TEXT PRIMARY KEY   -- kebab id, e.g. 'investor-weekly-update'
title        TEXT NOT NULL
content      TEXT NOT NULL      -- the precedent / few-shot (markdown prose)
derived_from TEXT               -- JSON array of source_ids it generalizes from
created_at   TEXT NOT NULL
```
All plays live in this table — house seeds and persona plays. Name prefix
determines population:

| Prefix | Who reads | Purpose |
|---|---|---|
| `howto:` | cold-start only | Teach the play-derivation move (how to go from raw history → a play row) |
| `reasoning:` | mind agent on demand | Inner-mode reasoning moves (notice-and-name, branch-with-closure, etc.) |
| `triage:` | diary agent | Worked triage traces (busy-morning, quiet-morning, recurring-matter) |
| *(none)* | diary agent | Persona plays — derived by cold-start from this principal's history |

**Common read patterns:**
```sql
-- Diary: triage plays (how to work a morning)
SELECT name, title, content FROM plays WHERE name LIKE 'triage:%';

-- Diary: persona plays (how THIS principal handles situations, for voice/handling)
SELECT name, title, content FROM plays
WHERE name NOT LIKE 'howto:%'
  AND name NOT LIKE 'reasoning:%'
  AND name NOT LIKE 'triage:%';

-- Mind agent: reasoning moves (on demand when invoking a specific move)
SELECT content FROM plays WHERE name = 'reasoning:notice-and-name';

-- Cold-start: derivation how-tos
SELECT name, title, content FROM plays WHERE name LIKE 'howto:%';
```

House seeds are upserted at boot from `prompts/seed-plays/` via
`seedHousePlays()`. The `create_play` tool (cold-start only) rejects any
name starting with a reserved prefix.

## Read-only context tables

- **events** — the bus audit log of everything that arrived. Columns:
  `id, kind, payload (JSON), source_id, observed_at, occurred_at, published_at`.
  Use it to find the REAL `source_id` of a matter (so citations are real) and
  to see raw inbound. e.g. `SELECT source_id, occurred_at, payload FROM events WHERE kind='webhook.persona' ORDER BY id DESC LIMIT 50`.
- **diary_components** — prior diary components. Columns: `id, diary_date, type, section, headline, rationale, template_id, content (JSON), actions (JSON), status, efference_prediction_id, position, supporting_artifact_ids (JSON)`. The date column is **`diary_date`**, NOT `date`. To dedup against recent days: `SELECT diary_date, section, headline, supporting_artifact_ids FROM diary_components WHERE diary_date >= date(:today, '-7 days') ORDER BY diary_date`.
- **diary_thinking_entries** — the per-day thinking-layer journal. Columns: `id, diary_date, tick_at, entries (JSON array)`.
- **diary_component_anchor_refs** — links components to anchors. Columns: `component_id, anchor_id, position, is_primary`.
- **diary_days** — one row per composed day. Its only column is `date`.

The diary writes diary_components / diary_thinking_entries via its structured
output tools, not raw SQL.

## Views

### subjects — unified anchors + entities (read-only)

A read-only view that lists every subject in one place with a single `name`
column. Use this when you want "everyone the principal touches, irrespective
of conviction tier" — listing recent activity, identity-handle lookup,
unioned name-search, etc.

```
id                TEXT          -- the node id (slug for entities, slug or '_principal' for anchors)
subject_kind      TEXT          -- 'anchor' or 'entity' (which underlying table)
name              TEXT          -- anchors.display_name for anchors; entities.id for entities (entities have no display_name)
kind              TEXT          -- anchors.kind for anchors; entities.kind_hint for entities
identity_handles  TEXT          -- JSON array of strings (always present)
last_active       TEXT          -- ISO 8601; anchors.last_bumped for anchors; entities.last_seen for entities
slow_precision    REAL          -- anchor only; NULL for entities
mid_precision     REAL          -- anchor only; NULL for entities
fast_precision    REAL          -- anchor only; NULL for entities
mention_count     INTEGER       -- entity only; NULL for anchors
```

Writes still go through the typed tools (`create_anchor`, `create_entity`,
`update_anchor_layer`, `promote_entity`, …) against the base tables — `subjects`
is for reads only.

```sql
-- Everyone the principal has touched recently, with a single name column
SELECT id, subject_kind, name, kind, last_active
FROM subjects
ORDER BY last_active DESC
LIMIT 50;

-- Subject by identity-handle (anchor or entity)
SELECT id, subject_kind, name, kind
FROM subjects
WHERE EXISTS (
  SELECT 1 FROM json_each(identity_handles) WHERE value = :handle
);
```

## Common read recipes

### Activated subjects (mind agent — top of an invocation)
```sql
-- Recent anchors summary
SELECT id, kind, display_name, identity_handles,
       slow_precision, mid_precision, fast_precision, last_bumped
FROM anchors
ORDER BY last_bumped DESC
LIMIT 50;

-- Recent entities summary
SELECT id, kind_hint, identity_handles, mention_count, last_seen
FROM entities
ORDER BY last_seen DESC
LIMIT 50;

-- The principal (always relevant)
SELECT * FROM anchors WHERE id = '_principal';
```

### Deep-read an activated subject
```sql
-- The node detail
SELECT * FROM anchors WHERE id = :id;          -- or entities
-- Its edges (both directions)
SELECT * FROM relationships WHERE subject_id = :id OR target_id = :id;
-- Its predictions + which anchor layers ground them
SELECT p.*, b.layer
FROM predictions p
LEFT JOIN prediction_layer_bindings b ON b.prediction_id = p.id
WHERE p.anchor_id = :id;
-- Its evidence
SELECT layer, source_id, date, note
FROM case_base_entries
WHERE node_id = :id
ORDER BY layer, position;
```

### Diary — what to consider this morning
```sql
-- Activated subjects (anchors + entities), recent first — via the subjects view
SELECT id, subject_kind, name, kind, last_active
FROM subjects
ORDER BY last_active DESC
LIMIT 100;

-- Predictions due today (consult as UNDERSTANDING, not agenda — see
-- `discipline/selection`)
SELECT p.*, a.display_name
FROM predictions p
JOIN anchors a ON a.id = p.anchor_id
WHERE p.kind = 'event' AND date(p.expected_by) <= date(:today);

-- Reminders firing today
SELECT * FROM reminders
WHERE fired_at IS NULL AND date(fires_at) <= date(:today)
ORDER BY fires_at;

-- Cross-day dedup against the last week
SELECT diary_date, section, headline, supporting_artifact_ids
FROM diary_components
WHERE diary_date >= date(:today, '-7 days')
ORDER BY diary_date;

-- Persona plays as few-shots (exclude the howto seeds)
SELECT name, title, content
FROM plays
WHERE name NOT LIKE 'howto:%';
```

### Mind agent — resolve which subject an event touches
```sql
-- By identity handle hint (json1 extension required, which better-sqlite3 has)
SELECT id, display_name, identity_handles
FROM anchors
WHERE EXISTS (
  SELECT 1
  FROM json_each(identity_handles)
  WHERE value = :handle
);
-- Then the same against entities. Identity handles are a HINT, not a match
-- rule — confirm with case_base and content semantics.
```

### Finding a REAL source_id for citation
```sql
-- Most recent events of a kind
SELECT id AS source_id, kind, occurred_at, payload
FROM events
ORDER BY id DESC LIMIT 50;

-- Events matching a sender / subject / etc — query the JSON payload
SELECT id AS source_id, occurred_at, json_extract(payload, '$.from') AS sender
FROM events
WHERE kind = 'webhook.persona'
  AND json_extract(payload, '$.from') LIKE :handle
ORDER BY occurred_at DESC LIMIT 20;
```

## Notes

- `run_sql` is **read-only** for every role. Mutations throw at the SQLite
  layer. Use the typed write tools — they handle FK ordering, ID generation,
  and atomicity for you.
- Use bound `params` — never `'${name}'`-style concatenation.
- For arithmetic on precision (support/contradict nudges), use the per-target
  family — `support_anchor_precision` / `contradict_anchor_precision`,
  `support_relationship_precision` / `contradict_relationship_precision`,
  `support_prediction_precision` / `contradict_prediction_precision`. Math +
  clamp live in the tool, not in the LLM and not in raw SQL.
