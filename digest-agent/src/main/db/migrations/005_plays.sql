-- 005: plays — the cognitive precedent / few-shot library.
--
-- Previously plays were static markdown files under <digest_dir>/plays/, read
-- via the list_plays / read_play file tools. They were never persona-specific
-- and (in test mode) never even seeded.
--
-- Now the cold-start agent DERIVES plays from the principal's observed history
-- (how they handle an investor update, a customer escalation, a calendar/family
-- conflict; their voice register in real sent mail; their suppression
-- precedents) and writes them here. The diary agent reads them as few-shots
-- when composing — a rich, persona-custom precedent library.
--
-- Read/written through the general-purpose run_sql substrate tool (cold-start
-- writes; diary reads via its read-only connection).

CREATE TABLE plays (
  name          TEXT PRIMARY KEY,   -- kebab id, e.g. 'investor-weekly-update'
  title         TEXT NOT NULL,      -- human-facing one-liner
  content       TEXT NOT NULL,      -- the precedent itself (markdown prose / few-shot)
  derived_from  TEXT,               -- JSON array of source_ids the play generalizes from
  created_at    TEXT NOT NULL
);
