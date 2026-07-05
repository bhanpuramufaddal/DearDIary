"""Synthetic-clock helpers.

The persona-generator produces artifacts timestamped inside the 35-day
synthetic window (2026-04-19 through 2026-05-23 Pacific). The digest agent
reads them as if it were "now" — every read can pass `?as_of=ISO_DATETIME`
to filter visible artifacts to those with `timestamp ≤ as_of`.

This module is the single source of truth for parsing `as_of`, picking
sensible defaults, and the SQL-friendly comparison string format.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

DEFAULT_AS_OF_ISO = "2026-05-23T23:59:59-07:00"  # end of window — everything visible
WINDOW_START_ISO = "2026-04-19T00:00:00-07:00"


def parse_as_of(value: Optional[str]) -> str:
    """Normalize an `as_of` query parameter to a full ISO 8601 string.

    Accepted inputs:
      - None / empty → DEFAULT_AS_OF_ISO (end of window; everything visible)
      - "YYYY-MM-DD"            → that date at 23:59:59 Pacific
      - "YYYY-MM-DDTHH:MM[:SS]" → assume Pacific (-07:00) if no offset
      - Full ISO with offset    → returned as-is

    Returns an ISO 8601 string with explicit TZ offset, suitable for
    string-comparison against the synthetic timestamps in the DB
    (which are all stored with `-07:00` offsets during this window).
    """
    if not value:
        return DEFAULT_AS_OF_ISO

    v = value.strip()

    # Date-only form
    if len(v) == 10 and v[4] == "-" and v[7] == "-":
        return f"{v}T23:59:59-07:00"

    # If it already has a TZ designator, accept as-is
    if "+" in v[10:] or "-" in v[10:] or v.endswith("Z"):
        return v

    # Datetime without TZ — assume Pacific
    if "T" in v and len(v) >= 16:
        # add seconds if missing
        if len(v) == 16:
            v = v + ":00"
        return v + "-07:00"

    # Last resort — try to coerce; raises if hopelessly malformed
    parsed = datetime.fromisoformat(v)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


def is_before_or_at(ts_iso: str, as_of_iso: str) -> bool:
    """True if ts_iso ≤ as_of_iso. String comparison works because both are
    ISO 8601 with TZ offset and within the same window (-07:00 Pacific)."""
    return ts_iso <= as_of_iso
