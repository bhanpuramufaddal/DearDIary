"""Service emulator — mail / calendar / notes services backed by a persona-generator SQLite DB.

Exposes the synthetic data the persona-generator produced via:
  - REST endpoints (mail, calendar, notes) with `?as_of=` filtering
  - Webhook publisher for event-based push during a replay
  - MCP servers for production-shape agent consumption

The digest-agent talks to this — never directly to persona.db.
"""

__version__ = "0.1.0"
