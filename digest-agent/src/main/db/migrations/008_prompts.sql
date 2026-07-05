-- 008: prompts — agent system prompts and playbook sections in SQLite.
--
-- Previously these lived as markdown files on the filesystem, read at every
-- agent invocation via readFileSync. They now live here so every substrate
-- tool and agent reads from the same SQL surface. Seeded at boot from the
-- bundled `prompts/` directory by seedPrompts(); per-principal overrides
-- (files the user drops in <digest_dir>/) win at seed time and are stored
-- as source='override'.
--
-- Two kinds:
--   'agent'    — the six system-prompt files: disposition + five role prompts.
--   'playbook' — the on-demand guidance library (substrate-schema, templates,
--                discipline rules, voice, customize, …).

CREATE TABLE IF NOT EXISTS prompts (
  name        TEXT PRIMARY KEY,  -- e.g. 'disposition', 'playbook/templates/email-draft.inline'
  kind        TEXT NOT NULL,     -- 'agent' | 'playbook'
  title       TEXT NOT NULL,     -- first # heading from content, or bare name
  content     TEXT NOT NULL,     -- full markdown
  source      TEXT NOT NULL,     -- 'bundled' | 'override'
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
