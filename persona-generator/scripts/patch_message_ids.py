#!/usr/bin/env python3
"""Patch a persona.db's message_ids to opaque hashes.

The old persona-generator scheme produced human-readable message_ids
(`<d24-jenna-comps-v1@holdfast.co>`), which downstream agents could
construct from descriptive context — they look guessable, so the agent's
"plausible pattern" matches reality often enough that hallucination feels
rewarded. Real Gmail message-ids are opaque hashes; this script rewrites an
existing persona.db to match that shape WITHOUT regenerating the persona
(timeline / content stays identical, only IDs change).

Uses the same `mint_message_id` algorithm as
`persona_generator.tools.artifact_emit`, so a re-emission of any
artifact_id-keyed row produces the same opaque id this script writes here.

Tables touched (FK chain):
  emails.message_id                (PK)
  emails.in_reply_to               (refs emails.message_id)
  email_threads.root_message_id    (refs emails.message_id)
  email_attachments.message_id     (refs emails.message_id; FK)
  calendar_ops.linked_message_id   (refs emails.message_id; FK, nullable)

email_threads.thread_id and calendar_ops.event_id are independent
identifiers (descriptive but never failed the agent in observed runs).
Out of scope for this script.

Usage:
  uv run python scripts/patch_message_ids.py <persona.db>
  uv run python scripts/patch_message_ids.py ../data/personas/avery_chen/persona.db

Idempotent: re-running on an already-migrated DB is a no-op (every row
hashes to itself when artifact_id is unchanged, and rows without an
artifact_id fall back to hashing their existing message_id which is also
stable).
"""
from __future__ import annotations

import hashlib
import sqlite3
import sys
from pathlib import Path


def _mint(seed_base: str, from_addr: str) -> str:
    """Same algorithm as persona_generator.tools.artifact_emit.mint_message_id.

    Seed is `f"{seed_base}|{from_addr}"` — pairing the artifact-side input
    with the sender lets back-and-forth exchanges on a single planned_artifact
    produce distinct ids per side.

    For rows that have an artifact_id, seed_base = artifact_id (matches
    future re-emissions). For rows without one (decoys, externally-sourced
    emails without a planned_artifact), seed_base = existing message_id —
    still deterministic; just not tied to a planned_artifact.
    """
    if "@" in from_addr:
        domain = from_addr.split("@", 1)[1].strip().strip(">").strip()
    else:
        domain = "persona.test"
    seed = f"{seed_base}|{from_addr}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:14]
    return f"<{digest}@{domain}>"


def patch(db_path: Path) -> None:
    if not db_path.exists():
        raise SystemExit(f"db not found: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = OFF")  # FKs would block intermediate states
    cur = conn.cursor()

    # 1. Build the old → new message_id map from emails.
    cur.execute("SELECT message_id, artifact_id, from_addr FROM emails")
    rows = cur.fetchall()
    id_map: dict[str, str] = {}
    for old_mid, artifact_id, from_addr in rows:
        seed = artifact_id if artifact_id else old_mid
        new_mid = _mint(seed, from_addr or "persona.test")
        id_map[old_mid] = new_mid

    # 2. Detect already-migrated DBs (all old==new). Bail early with a clean log.
    if all(old == new for old, new in id_map.items()):
        print(f"[patch] {db_path.name}: all {len(id_map)} message_ids already opaque — no-op")
        return

    # Collision check: ensure new_mid uniqueness.
    if len(set(id_map.values())) != len(id_map):
        # find dupes for the error message
        from collections import Counter
        dupes = [m for m, n in Counter(id_map.values()).items() if n > 1]
        raise SystemExit(
            f"[patch] hash collision detected in {len(dupes)} new ids: {dupes[:3]} "
            "(this should be vanishingly rare with sha256[:14]; investigate before re-running)"
        )

    print(f"[patch] {db_path.name}: {len(id_map)} emails to migrate")

    # 3. Update in dependency order. SQLite UPDATE on a PK rewrites; the FKs
    # (foreign_keys OFF) and unique constraint don't block intermediate states.
    # We update emails first (PK), then emails.in_reply_to references, then
    # email_threads.root_message_id, then email_attachments.message_id, then
    # calendar_ops.linked_message_id.
    #
    # All updates use the same id_map; ordering is just for clarity.

    n_emails = 0
    n_replies = 0
    n_threads = 0
    n_attachments = 0
    n_cal_ops = 0

    for old_mid, new_mid in id_map.items():
        if old_mid == new_mid:
            continue  # no-op row (e.g., already-migrated)
        cur.execute("UPDATE emails SET message_id = ? WHERE message_id = ?", (new_mid, old_mid))
        n_emails += cur.rowcount

    for old_mid, new_mid in id_map.items():
        if old_mid == new_mid:
            continue
        cur.execute(
            "UPDATE emails SET in_reply_to = ? WHERE in_reply_to = ?",
            (new_mid, old_mid),
        )
        n_replies += cur.rowcount
        cur.execute(
            "UPDATE email_threads SET root_message_id = ? WHERE root_message_id = ?",
            (new_mid, old_mid),
        )
        n_threads += cur.rowcount
        cur.execute(
            "UPDATE email_attachments SET message_id = ? WHERE message_id = ?",
            (new_mid, old_mid),
        )
        n_attachments += cur.rowcount
        cur.execute(
            "UPDATE calendar_ops SET linked_message_id = ? WHERE linked_message_id = ?",
            (new_mid, old_mid),
        )
        n_cal_ops += cur.rowcount

    conn.commit()
    conn.close()

    print(
        f"[patch] {db_path.name}: rewrote "
        f"emails={n_emails}, in_reply_to={n_replies}, "
        f"thread_roots={n_threads}, attachments={n_attachments}, "
        f"calendar_linked={n_cal_ops}"
    )


def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    db_path = Path(sys.argv[1]).resolve()
    patch(db_path)


if __name__ == "__main__":
    main()
