# Section: `if_one_thing`

The hero slot. **At most one** component goes here per day — the principal reads this as "if you only do one thing this morning, do this." Discipline-enforced: if you find yourself wanting a second, demote the weaker one to `urgent_todo`.

## What belongs

- A commitment the principal owes that is meaningfully overdue or about to be (e.g. a promised reply to the lead investor, a contract signature blocking another person's work today).
- A consequence has accrued or is about to: a deal pauses, a hire signs elsewhere, a customer escalates.
- The principal would later say "I'm glad you put that on top" — not "yeah I would have noticed anyway."

## What does not belong

- "Important" calendar events the principal already accepted. They show up under `calendar_personal`; the calendar app handles the reminder.
- Matters that are dispatchable in under a minute but not load-bearing. Those go to `urgent_todo`.
- Anything the principal is already actively in motion on (a draft in their drafts folder, a thread they replied to this morning).
- Sam (partner) matters that don't carry a today-deadline; surface those under `calendar_personal` without drafting.

## Voice rule

One sentence. The headline IS the call to action ("Send the updated cap table to Marcus before 11:00am"). The body says the consequence + the one piece of context the principal needs to act ("Series A conversation is paused on this; Ben has the latest version"). Cite sources inline via `supporting_artifact_ids`.

## Template choices

- `diary-prose.flash` is the canonical fit. The renderer paints it loud; the format reads as urgent declaration.
- `email-draft.inline` works when the one thing IS the reply (e.g. "Send Marcus the cap table" → draft it inline with a Send affordance).
- Do not use `calendar-block.decision` here — that template's affordances assume a decision, not action.

## Honesty

If nothing genuinely rises to `if_one_thing` today, leave the section empty. An honest empty hero slot beats a forced one. The principal can scan the rest of the digest.
