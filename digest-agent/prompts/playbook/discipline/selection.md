# Discipline: what merits surfacing TODAY

The digest is a *daily* artifact. The question is never "is this matter live / important?" — almost everything in the substrate is live and important, that's why it's there. The question is: **does this matter need the principal *today*?** Most live matters do not. This doc is the gate between "I know about this" and "I put it on the page."

It exists because the most common failures are timing failures, not knowledge failures: a matter surfaced a day early, the same matter surfaced three mornings running, a quiet day padded with five standing items. The substrate already knew everything; the diary just failed to decide *when*.

## Start from open loops, derived from the world record

What needs the principal today is, almost always, an **open loop**: a matter where the next move is unresolved and the ball is on the principal's side. You find open loops from the **world record** — the live inbox / calendar / notes and the captured `events` / `case_base_entries` — not from a precomputed list. For each active matter, ask the world: *what was the last move, and is it unresolved?*

- The last message in a thread is inbound and the principal hasn't answered → the ball is on the principal. Open loop.
- A commitment the principal made ("I'll send the addendum by Friday") with no outbound closing it → open loop, the principal owes the move.
- A time-anchored beat lands today/tomorrow (a meeting needing prep, a deadline, an RSVP that closes) → open loop on the calendar.
- The last move was the principal's and nobody has replied → the ball is on the *other* side. **Not** an open loop for the principal — it waits (see `discipline/suppression`).

"Open loop" is one general test you apply to every matter by reading the record. It is not a list of obligation types to memorize, and it is not something the mind agent pre-flags — you derive it fresh each morning from what actually happened.

## Predictions are understanding, not agenda

Do **not** read the `predictions` table as a to-do list. Predictions are the mind agent's *epistemic* instrument — calibrated beliefs about how the world behaves ("Marcus replies within 24h", "Avery ships the investor update Fridays") that exist so the system can model an anchor and learn from being right or wrong. A prediction is "what the model expects," never "what the principal must do." Surfacing a matter because a prediction points at it surfaces the model's expectations instead of the principal's actual obligations.

Predictions earn their place in surfacing in exactly one way: as **understanding that sharpens a judgment you already reached from the world record.**

- **Anomaly.** A well-calibrated prediction the world is now *violating* is signal. "Marcus always replies within a day; it's been five." The thing that may surface is the *understanding* ("something's off on the Marcus thread"), grounded in the open loop (his silence) — not the prediction row.
- **Weighting.** A prediction tells you how much an open loop matters and how to read it (is this silence normal for them, or out of character?).
- **A genuinely forward event** ("term sheet signs Friday") overlaps with a time-anchored beat — but the surfacing reason is *the beat landing*, not the existence of the prediction.

If you catch yourself querying predictions to decide *what* to surface, stop — you're borrowing the mind's epistemic structure to answer a selection question. Derive the open loops from the record; let predictions inform how you weigh them.

## The due-today gate

An open loop earns a component only if at least one is true **today**:

1. **The next move is the principal's and it can't keep waiting** — a reply is owed and the matter is time-sensitive or the person matters; a signature/approval/decision is needed; a deadline falls inside the principal's action horizon (read it from `profile.md`).
2. **It changed since they last saw it** — new inbound landed, the other side finally replied, status moved.
3. **A time-anchored beat lands today or tomorrow** — a meeting that needs prep, a `reminder` firing, a deadline or RSVP crossing into the horizon.
4. **It is genuinely urgent and new** — the "see this right now" class (`diary-prose.flash`, `if_one_thing`).

If none hold, the matter is **live but not due**. Do not surface it. It waits. A deal you flagged yesterday where nothing moved overnight is not a today-matter — surfacing it again just teaches the principal that the digest repeats itself.

## Read wide to find the open loops — entities, not just anchors

Open loops attach to matters the substrate hasn't fully committed to yet. Read **every entity touched recently** — `SELECT * FROM entities ORDER BY last_seen DESC` — and read the `case_base_entries` of touched entities *and* anchors, then go back to the world record for those subjects to establish the last move. Entity-attached matters (a new person who just emailed, a provisional project, a one-off ask) are the most-missed precisely because they haven't earned anchor status — but a provisional thing can still hold an open loop that's due today. The mind agent under-promotes by design (conviction is earned slowly); the diary compensates by reading wide. Use the substrate to know *who's in play and how much they matter*; use the world record to know *what's open*.

## Cross-day dedup — the progression test

Before surfacing anything, read the recent prior diaries (`SELECT diary_date, section, headline, supporting_artifact_ids FROM diary_components WHERE diary_date >= date(:today,'-7 days') ORDER BY diary_date` — the column is `diary_date`, not `date`). If you already surfaced this matter, re-surface **only if the open loop has progressed** — the ball moved:

- They acted, and now a *follow-up* is due → surface the follow-up, not the original.
- New inbound arrived (the other side finally replied) → surface the *new state*.
- A deadline moved into the action horizon → surface the *now-urgent timing*.

Otherwise, do **not** re-surface. "Reply to Mara" three mornings running, unchanged, is the single fastest way to train the principal to stop reading the digest. **Repetition without progression is noise**, even when the underlying matter is real.

## Quiet days are a real outcome

Some mornings nothing is due. On those mornings the correct digest is **empty, or one or two items** — never five manufactured ones. The failure mode is padding: re-surfacing live-but-not-due matters, promoting FYI items to fill `team_pulse`, restating standing status that hasn't moved. Resist all of it. An empty page on a genuinely quiet day is the filter *working*, not failing — it's the proof that the digest is trustworthy. Two items that are genuinely due beats six that merely exist. When you write nothing (or almost nothing), leave a thinking-layer note on what you saw and why it didn't rise — that's the audit trail, not a component.

## Cite real sources

Every concrete claim cites a **real** `source_id` — one you pulled from the `events` table (`SELECT id, kind, source_id, occurred_at FROM events WHERE ...` — note the column is `source_id`, not `source`) or directly from the live email/calendar/notes MCP. Never synthesize a plausible-looking id (`gmail:<kevin_redline_push>` is fabrication, not citation). If you can't find the real id, you can't cite it: drop the claim or mark it uncertain (see `discipline/honesty`). A citation that doesn't resolve is worse than no citation.
