-- Migration 001: initial schema.
-- See design/11-backend-architecture.md#schema-ddl for the canonical spec.

-- Nodes parent table — every anchor and entity has a row here.
-- Relationships and case-base entries FK against nodes so they work uniformly across both kinds.
CREATE TABLE nodes (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('anchor', 'entity')),
  created_at  TEXT NOT NULL
);

-- Anchors: committed cognitive primitives.
-- Layer prose + precision are rigid columns; the layer's case base lives in case_base_entries.
CREATE TABLE anchors (
  id                 TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  display_name       TEXT,
  kind               TEXT NOT NULL DEFAULT 'subject',
  activation         REAL NOT NULL DEFAULT 0,
  last_bumped        TEXT NOT NULL,
  identity_handles   TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  slow_content       TEXT,
  slow_precision     REAL,
  mid_content        TEXT,
  mid_precision      REAL,
  fast_content       TEXT,
  fast_precision     REAL,
  notes              TEXT
);
CREATE INDEX idx_anchors_last_bumped ON anchors(last_bumped);

-- Entities: provisional cognitive primitives. Flat — no layers.
CREATE TABLE entities (
  id                 TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  kind_hint          TEXT,
  first_seen         TEXT NOT NULL,
  last_seen          TEXT NOT NULL,
  mention_count      INTEGER NOT NULL DEFAULT 1,
  identity_handles   TEXT NOT NULL DEFAULT '[]',
  notes              TEXT
);
CREATE INDEX idx_entities_last_seen      ON entities(last_seen);
CREATE INDEX idx_entities_mention_count  ON entities(mention_count);

-- Relationships: directed edges.
-- target_id FKs against anchors(id) for proper cascade semantics; the trigger
-- below provides a defense-in-depth check that catches mis-typed inserts before
-- the FK does (clearer error message).
CREATE TABLE relationships (
  id              TEXT PRIMARY KEY,
  subject_id      TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id       TEXT NOT NULL REFERENCES anchors(id) ON DELETE CASCADE,
  slow_claim      TEXT,
  slow_precision  REAL,
  mid_claim       TEXT,
  mid_precision   REAL,
  fast_claim      TEXT,
  fast_precision  REAL,
  UNIQUE (subject_id, target_id)
);
CREATE INDEX idx_relationships_subject ON relationships(subject_id);
CREATE INDEX idx_relationships_target  ON relationships(target_id);

CREATE TRIGGER relationships_target_must_be_anchor_insert
BEFORE INSERT ON relationships
BEGIN
  SELECT RAISE(ABORT, 'relationship target must be an anchor')
  WHERE (SELECT kind FROM nodes WHERE id = NEW.target_id) IS NOT 'anchor';
END;

CREATE TRIGGER relationships_target_must_be_anchor_update
BEFORE UPDATE OF target_id ON relationships
BEGIN
  SELECT RAISE(ABORT, 'relationship target must be an anchor')
  WHERE (SELECT kind FROM nodes WHERE id = NEW.target_id) IS NOT 'anchor';
END;

-- Predictions: anchor-bound facts.
-- expected_by is required for kind='event' and forbidden otherwise.
CREATE TABLE predictions (
  id                   TEXT PRIMARY KEY,
  anchor_id            TEXT NOT NULL REFERENCES anchors(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL CHECK (kind IN ('event', 'fact', 'pattern')),
  claim                TEXT NOT NULL,
  expected_by          TEXT,
  precision            REAL NOT NULL,
  created_at           TEXT NOT NULL,
  source_dispatchable  TEXT,
  CHECK ((kind = 'event' AND expected_by IS NOT NULL) OR (kind <> 'event' AND expected_by IS NULL))
);
CREATE INDEX idx_predictions_anchor              ON predictions(anchor_id);
CREATE INDEX idx_predictions_expected_by         ON predictions(expected_by);
CREATE INDEX idx_predictions_source_dispatchable ON predictions(source_dispatchable);

-- Junction for prediction.based_on layers.
CREATE TABLE prediction_layer_bindings (
  prediction_id  TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  anchor_id      TEXT NOT NULL REFERENCES anchors(id)     ON DELETE CASCADE,
  layer          TEXT NOT NULL CHECK (layer IN ('slow', 'mid', 'fast')),
  PRIMARY KEY (prediction_id, layer)
);

-- Case-base entries: one row per citation.
-- layer is NULL for entities (flat case base); one of slow/mid/fast for anchors.
CREATE TABLE case_base_entries (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  layer       TEXT CHECK (layer IN ('slow', 'mid', 'fast') OR layer IS NULL),
  source_id   TEXT NOT NULL,
  date        TEXT NOT NULL,
  note        TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_case_base_source ON case_base_entries(source_id);
CREATE INDEX idx_case_base_node   ON case_base_entries(node_id, layer, position);

-- Reminders.
CREATE TABLE reminders (
  id        TEXT PRIMARY KEY,
  fires_at  TEXT NOT NULL,
  context   TEXT NOT NULL,
  set_by    TEXT NOT NULL CHECK (set_by IN ('mind_agent', 'diary_agent')),
  set_at    TEXT NOT NULL,
  fired_at  TEXT
);
CREATE INDEX idx_reminders_fires_at ON reminders(fires_at) WHERE fired_at IS NULL;

CREATE TABLE reminder_anchor_refs (
  reminder_id  TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  anchor_id    TEXT NOT NULL REFERENCES anchors(id)   ON DELETE CASCADE,
  PRIMARY KEY (reminder_id, anchor_id)
);

-- Diary tables.
CREATE TABLE diary_days (
  date TEXT PRIMARY KEY
);

CREATE TABLE diary_components (
  id                       TEXT PRIMARY KEY,
  diary_date               TEXT NOT NULL REFERENCES diary_days(date) ON DELETE CASCADE,
  type                     TEXT NOT NULL,
  section                  TEXT NOT NULL CHECK (section IN ('right_now', 'on_the_desk', 'tracking', 'background')),
  headline                 TEXT,
  rationale                TEXT,
  template_id              TEXT NOT NULL,
  content                  TEXT NOT NULL DEFAULT '{}',
  actions                  TEXT NOT NULL DEFAULT '[]',
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acted', 'closed', 'dismissed')),
  efference_prediction_id  TEXT REFERENCES predictions(id) ON DELETE SET NULL,
  position                 INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_diary_components_day_section ON diary_components(diary_date, section, position);

CREATE TABLE diary_component_anchor_refs (
  component_id  TEXT NOT NULL REFERENCES diary_components(id) ON DELETE CASCADE,
  anchor_id     TEXT NOT NULL REFERENCES anchors(id)          ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (component_id, anchor_id)
);

CREATE TABLE diary_comments (
  id            TEXT PRIMARY KEY,
  component_id  TEXT NOT NULL REFERENCES diary_components(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE diary_notes (
  id          TEXT PRIMARY KEY,
  diary_date  TEXT NOT NULL REFERENCES diary_days(date) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE diary_thinking_entries (
  id          TEXT PRIMARY KEY,
  diary_date  TEXT NOT NULL REFERENCES diary_days(date) ON DELETE CASCADE,
  tick_at     TEXT NOT NULL,
  entries     TEXT NOT NULL DEFAULT '[]'
);

-- Bus audit log + durable subscriber cursors.
CREATE TABLE events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,
  payload       TEXT NOT NULL,
  source_id     TEXT,
  observed_at   TEXT,
  occurred_at   TEXT,
  published_at  TEXT NOT NULL
);
CREATE INDEX idx_events_kind_published ON events(kind, published_at DESC);

CREATE TABLE event_subscriber_cursors (
  subscriber_name  TEXT PRIMARY KEY,
  last_event_id    INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL
);
