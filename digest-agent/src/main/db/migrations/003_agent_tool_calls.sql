-- Audit log of every MCP tool invocation made by the mind / diary / cold-start
-- agents. One row per tool call. Used to RCA "what did the agent actually do?"
-- vs prompt expectations (e.g. "mind exited 0 but wrote 0 anchors — what did
-- it call?"). Inspected via `scripts/debug-tools.ts`.

CREATE TABLE agent_tool_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invocation_id TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mind','diary','cold-start')),
  tool_name     TEXT NOT NULL,
  args_json     TEXT NOT NULL,
  result_json   TEXT,
  error         TEXT,
  started_at    TEXT NOT NULL,
  ended_at      TEXT NOT NULL,
  duration_ms   INTEGER NOT NULL
);

CREATE INDEX idx_agent_tool_calls_invocation ON agent_tool_calls(invocation_id);
CREATE INDEX idx_agent_tool_calls_role_ts    ON agent_tool_calls(role, started_at);
