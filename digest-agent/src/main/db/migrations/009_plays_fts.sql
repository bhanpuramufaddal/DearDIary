-- 009: plays_fts — FTS5 full-text search index over the plays table.
--
-- Enables BM25 keyword search via run_sql:
--   SELECT p.name, p.title,
--          snippet(plays_fts, 2, '**', '**', '...', 24) AS excerpt
--   FROM plays_fts
--   JOIN plays p ON p.rowid = plays_fts.rowid
--   WHERE plays_fts MATCH :query
--   ORDER BY bm25(plays_fts)
--   LIMIT 10;
--
-- Three fields indexed: name (the kebab id), title, and full content.
-- Porter stemmer so "investors" matches "investor" etc.
-- Content-table mode keeps the data in plays — no duplication. Triggers
-- keep plays_fts in sync on every insert, update, and delete.

CREATE VIRTUAL TABLE IF NOT EXISTS plays_fts USING fts5(
  name,
  title,
  content,
  content='plays',
  content_rowid='rowid',
  tokenize='porter ascii'
);

-- Seed from existing plays.
INSERT INTO plays_fts(rowid, name, title, content)
SELECT rowid, name, title, content FROM plays;

-- Keep in sync.
CREATE TRIGGER plays_ai AFTER INSERT ON plays BEGIN
  INSERT INTO plays_fts(rowid, name, title, content)
  VALUES (new.rowid, new.name, new.title, new.content);
END;

CREATE TRIGGER plays_ad AFTER DELETE ON plays BEGIN
  INSERT INTO plays_fts(plays_fts, rowid, name, title, content)
  VALUES ('delete', old.rowid, old.name, old.title, old.content);
END;

CREATE TRIGGER plays_au AFTER UPDATE ON plays BEGIN
  INSERT INTO plays_fts(plays_fts, rowid, name, title, content)
  VALUES ('delete', old.rowid, old.name, old.title, old.content);
  INSERT INTO plays_fts(rowid, name, title, content)
  VALUES (new.rowid, new.name, new.title, new.content);
END;
