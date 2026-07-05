-- 006: subjects view — unified read surface over anchors + entities.
--
-- Architectural fix for the recurring mind-agent run_sql error pattern:
--   - "no such column: display_name" against entities (entities use id as the
--     slug name; display_name is anchor-only)
--   - "no such table: anchors_view" (the agent invented this name twice — a
--     signal the abstraction is missing)
--   - JOINs of nodes + entities + anchors that get column placement wrong
--
-- Rather than enumerate gotchas in the prompt (whack-a-mole), give the agent
-- the abstraction it keeps reaching for: a single view that lists every
-- subject in the world (anchor or entity) with a unified `name` column,
-- `subject_kind`, `kind` (domain kind / kind_hint), identity_handles, and a
-- `last_active` timestamp for recency ordering.
--
-- For anchors: `name` = display_name (human-curated), `kind` = anchors.kind.
-- For entities: `name` = id (slug; entities have no display_name by design),
--               `kind` = kind_hint.
--
-- This is a read-only SQLite VIEW — it lives alongside the base tables and is
-- accessible via `run_sql` (the read-only connection). Writes still go through
-- typed tools against `anchors` / `entities` directly.

CREATE VIEW subjects AS
  SELECT
    a.id,
    'anchor'         AS subject_kind,
    a.display_name   AS name,
    a.kind           AS kind,
    a.identity_handles,
    a.last_bumped    AS last_active,
    a.slow_precision,
    a.mid_precision,
    a.fast_precision,
    NULL             AS mention_count
  FROM anchors a
  UNION ALL
  SELECT
    e.id,
    'entity'         AS subject_kind,
    e.id             AS name,
    e.kind_hint      AS kind,
    e.identity_handles,
    e.last_seen      AS last_active,
    NULL             AS slow_precision,
    NULL             AS mid_precision,
    NULL             AS fast_precision,
    e.mention_count
  FROM entities e;
