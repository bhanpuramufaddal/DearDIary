-- Migration 002: cross-process bus event relay queue.
--
-- The surface MCP server (and any future out-of-process writer) can't call
-- bus.emit() directly because the bus lives in main's heap. Instead, it
-- inserts a row here, and main's event-relay subsystem polls + emits + deletes.
--
-- The events audit table itself (`events`) is downstream of the relay: when
-- main calls bus.emit() it inserts there, just like an in-process emit. From
-- a downstream subscriber's perspective, surface-originated events are
-- indistinguishable from main-originated ones.

CREATE TABLE pending_bus_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,    -- JSON
  source_id   TEXT,             -- optional source_id audit hint
  written_at  TEXT NOT NULL
);
CREATE INDEX idx_pending_bus_events_written_at ON pending_bus_events(written_at);
