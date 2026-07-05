# Play: triaging a busy morning

**What this teaches:** how to go from a raw morning to a short digest by deriving *open loops* from the world record and gating on *due-ness* — not by scanning the substrate for things to say. The names here are illustrative; the method is the point.

## The raw morning (what the record actually held)

Seven things touched the principal's world since the last day boundary:

1. **Lead investor → principal, 2 days ago, unanswered:** "Can you send the updated cap table before our partner meeting Thursday?" Last move is theirs.
2. **A thread the principal closed yesterday:** they sent the final Q2 numbers to a colleague; no reply since. Last move is the principal's.
3. **An industry newsletter** (weekly roundup).
4. **A direct report → principal, this morning:** "Deploy is blocked on the migration — can you approve the rollback so we can ship?" Last move is theirs.
5. **A calendar event tomorrow 9am:** "Board prep," no agenda attached, no notes.
6. **A cold vendor pitch** naming the company, from a sender with no prior contact.
7. **A live partnership thread** that's been moving for a week; yesterday the *other* side replied with next steps; nothing lands on the principal today.

## The reasoning (open loop? ball where? due today?)

- **(1) Investor cap table.** Last move inbound, unanswered → open loop, ball on the principal. The substrate says this investor is P0 during an active raise and a fast replier — so silence here is costly and the Thursday beat is close. **Due today.** It's a sub-3-sentence send → draft it (`email-draft.inline`), cite the investor's real message id, emit an efference prediction for the reply.
- **(2) Q2 numbers thread.** Last move was the principal's; nobody has replied → ball on the *other* side. **Not an open loop for the principal.** They already know. Suppress — do not "remind them they're waiting."
- **(3) Newsletter.** Noise. Suppress (see `discipline/suppression`).
- **(4) Deploy rollback approval.** Inbound this morning, asking for a decision → open loop, ball on the principal, a report is blocked *right now*. **Due today**, highest urgency. A clean yes/no → `choose-one.cards` or an approve component; cite the report's message id.
- **(5) Board prep, no agenda.** A time-anchored beat lands tomorrow and there's a *gap* — no agenda, no prep. The gap is the open loop. **Due today** (you prep the day before). Surface under `calendar_personal`, citing the calendar event id; note what's missing.
- **(6) Vendor pitch.** Cold sender, no anchor → suppress.
- **(7) Partnership thread.** It's live and important — but the last move was the other side's and nothing needs the principal *today*. **Live but not due.** Hold. Note in the thinking layer so tomorrow you remember you saw it.

## What got written

Three components — investor cap table (`urgent_todo`, drafted reply), deploy approval (`if_one_thing`, the one that hurts most if dropped), board-prep gap (`calendar_personal`). Three suppressed (newsletter, vendor, the last-word thread). One held (partnership). Every claim cites a real `source_id`. The thinking layer records the held item and *why* the three suppressions were right.

**The shape to internalize:** seven inputs → three components. The cut came from asking "is the ball on the principal, and does it need them today?" — not from how interesting each item was.
