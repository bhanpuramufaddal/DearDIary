# Action classes — what response shape this matter needs

Every component you write expresses one of six implicit action classes via its template choice and the affordances on its `actions` array. There is no `action_class` schema field — the rubric reads the class off the rendered component. Pick the right template; the class falls out.

## The six classes

### `dispatch_immediate`
The matter has a single right next step that takes the principal under a minute: send the drafted reply, sign the document, accept the invite.
- **Template:** `email-draft.inline` (for replies), `calendar-block.decision` with a single primary action (for accepts), or a `diary-prose.note` carrying a one-click action.
- **Default section:** `urgent_todo` or `if_one_thing` if it's the hero.

### `reply_short`
The matter needs the principal to write a short response themselves — either profile.md forbids drafting, or the response is one the principal must say in their own voice (e.g. anything to a partner).
- **Template:** `free-text-reply.compose`.
- **Default section:** `urgent_todo`.

### `approve`
A binary yes/no signature where the principal is the gating approver. No multi-option weighing.
- **Template:** `email-draft.inline` (if approval IS sending an email), `calendar-block.decision` (accepting an invite), or `diary-prose.note` if the approval happens in another tool (DocuSign, an internal admin).
- **Default section:** `urgent_todo` or `decisions_approvals` depending on whether the principal is blocking someone.

### `decide`
A multi-option choice with non-trivial trade-offs. The principal weighs and picks.
- **Template:** `choose-one.cards` (2–5 options) or `diary-prose.note` framing the question if the options aren't enumerable.
- **Default section:** `decisions_approvals`.

### `track`
Awareness, not action. The principal should know this changed; no decision is owed today.
- **Template:** `diary-prose.note`, `big-number.metric`, `stat-block.summary`, `chart.timeseries`, `chart.bar`, `report.brief`.
- **Default section:** `team_pulse` or `calendar_personal`.

### `fyi`
Lightest awareness — the principal might glance, might skip. If you find yourself classifying things as `fyi`, ask whether they actually deserve a component at all. Most do not (see `discipline/suppression`).
- **Template:** `diary-prose.note` (terse).
- **Default section:** `team_pulse`.

## How to pick

The class is your read on the matter, not a schema slot. The principal sees rendered prose + affordances; the class shows through naturally if the template fits the shape of the right next step.

If two classes both fit (e.g. "the approve action IS sending an email"), pick the template that gives the principal the affordance closest to the work. `email-draft.inline` with a `send_email` action is `dispatch_immediate` AND `approve` — that's fine, the rubric reads either.

## Anti-patterns

- A `choose-one.cards` for a binary signature → that's `approve`, not `decide`. Use a draft + send pattern.
- A `diary-prose.flash` for a `track` matter → flash is reserved for the single hero `if_one_thing`. Don't yell when you don't have to.
- A `report.brief` for a daily roll-up → reports are for synthesis (weekly), not for daily team-pulse density.
