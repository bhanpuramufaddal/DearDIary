-- 005: loosen the `section` CHECK on diary_components and add
-- `supporting_artifact_ids` for per-component source citations.
--
-- Two changes packaged together because they both touch the diary_components
-- table; doing them in one migration avoids two table recreations.
--
-- Why loosen the CHECK: the original 4 values (`right_now`, `on_the_desk`,
-- `tracking`, `background`) are time-horizon buckets. The agent should be free
-- to organize the digest by whatever taxonomy fits the moment — topical
-- (e.g. `urgent_todo`, `decisions_approvals`, `calendar_personal`),
-- time-horizon (legacy), or whatever a customize.md instructs. Section
-- vocabulary now lives in the prompt/playbook, not in the schema.
--
-- Why supporting_artifact_ids: webhook events propagate `source_id` (e.g.
-- `gmail:<msg-id>`, `gcal:<event-uid>`) into anchor case_base entries, but
-- the diary component carried only `anchor_refs[]`. Inline citations
-- (`*[email: Marcus, May 19 16:42]*`) need source ids per-component so the
-- renderer can format them.

-- SQLite can't DROP a CHECK constraint in place; we recreate the table.
PRAGMA foreign_keys=OFF;

CREATE TABLE diary_components_new (
  id                       TEXT PRIMARY KEY,
  diary_date               TEXT NOT NULL REFERENCES diary_days(date) ON DELETE CASCADE,
  type                     TEXT NOT NULL,
  section                  TEXT NOT NULL,
  headline                 TEXT,
  rationale                TEXT,
  template_id              TEXT NOT NULL,
  content                  TEXT NOT NULL DEFAULT '{}',
  actions                  TEXT NOT NULL DEFAULT '[]',
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acted', 'closed', 'dismissed')),
  efference_prediction_id  TEXT REFERENCES predictions(id) ON DELETE SET NULL,
  position                 INTEGER NOT NULL DEFAULT 0,
  supporting_artifact_ids  TEXT NOT NULL DEFAULT '[]'
);

INSERT INTO diary_components_new (
  id, diary_date, type, section, headline, rationale, template_id,
  content, actions, status, efference_prediction_id, position
)
SELECT
  id, diary_date, type, section, headline, rationale, template_id,
  content, actions, status, efference_prediction_id, position
FROM diary_components;

DROP TABLE diary_components;
ALTER TABLE diary_components_new RENAME TO diary_components;

CREATE INDEX idx_diary_components_day_section ON diary_components(diary_date, section, position);

PRAGMA foreign_keys=ON;
