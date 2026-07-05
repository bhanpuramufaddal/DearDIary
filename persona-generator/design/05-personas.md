# The Four Reference Personas

Each persona is created by `persona-gen new "<prompt>"`. All four YAMLs are committed. They stress-test the engine across very different professions — if the same ten-stage pipeline produces lived-in data for all four, it's a generalizable system, not "Avery's tool."

## Summary

| Slug | Prompt sketch | Stress-tests |
|---|---|---|
| `avery_chen` | CEO, seed B2B SaaS, 12 ppl, Oakland, partner + young kid, PT | Investor raise + customer health + family — cross-source contradictions |
| `vikram_mehta` | L/S equity PM at a multi-strat fund, NYC, single, ET | Numeric signal in prose; LP relations; regulators |
| `dana_levin` | AmLaw 50 litigation partner, DC, partner + 2 teens, ET | Hard court deadlines; adversarial counsel as P0 |
| `aisha_williams` | VP Product at Google (~$1B surface), Mountain View, partner + 2 kids, PT | Inside-the-machine signal: skip-levels, OKR cycles, exec politics |

## What makes each distinct

**Avery Chen — startup CEO.** The brief's nominal target. A 37-year-old running a 12-person seed-stage B2B SaaS in Oakland. Partner Sam, a 4-year-old (Wren). Pacific time. The cross-pressures are the test: a Series A raise running in parallel with a churning customer, an engineering hire in late stages, a board meeting next week, and a preschool event Friday. The digest must rank these against each other without flattening them into "emails to read." Avery is the calibration persona — the depth check that other personas are measured against.

**Vikram Mehta — L/S equity PM.** A mid-thirties portfolio manager at a multi-strat fund, NYC, eastern time. Single, lives downtown. The stress test is **numeric signal in prose**: earnings reports, analyst notes, position commentary — the kinds of artifacts where a price target or basis-point delta matters more than the surrounding paragraph. LP relations introduce a different P0 dynamic than Avery's investors (LPs measure the manager, not the company). Regulators (SEC, compliance) appear as cold mandatory P0s with their own tonal register. If the engine can render a credible weekly LP email and an SEC-comment-letter response in the same week, the prose machinery is general enough.

**Dana Levin — AmLaw 50 litigation partner.** DC-based, mid-forties, partner with two teenagers. Eastern time. **Hard court deadlines** are the dominant constraint — a motion due at 5pm is not negotiable in the way an investor IC is. Adversarial counsel sits at P0 with a fundamentally different relational register than Avery's investors: cordial-but-opposed, with explicit on-the-record and off-the-record modes. Dana stress-tests the engine's ability to write artifacts where formality and procedure are load-bearing — depositions, filings, opposing-counsel correspondence — without making them feel like form letters. Two teenagers introduce family pressure that surfaces on a different cadence than Avery's preschool concerns.

**Aisha Williams — VP Product at Google.** Mountain View, late forties, partner with two kids. Pacific time. Surface ~$1B. The stress test is **inside-the-machine signal**: skip-level 1:1s, OKR check-ins, exec staff reads, cross-org reviews, perf calibration cycles, GenAI-launch politics. None of these come from outside the company — there are no investors, no LPs, no court deadlines. The pressure is structural and political-within-the-org (not US politics). The digest has to surface a skip-level's offhand comment as a P0 while ignoring a five-hundred-person dist-list announcement. Family pressure (two kids, school-age) sits adjacent to a job where promotion cycles and OKR drafts matter on monthly cadence. Aisha is the test that the engine isn't covertly tuned for founders.

## Why these four

A generator that handles **four categorically different jobs** isn't accidentally a founder-data tool. Each persona stresses a distinct axis:

- Avery — cross-source contradictions between work, fundraising, and family.
- Vikram — numeric signal in prose; institutional finance register.
- Dana — non-negotiable hard deadlines; adversarial relationships at P0.
- Aisha — political signal inside an organization; no external pressure.

If the same ten-stage pipeline produces credible 35-day data for all four — characters who feel like real, working professionals, storylines that resolve at different paces, ideal digests that look different from each other — the engine generalizes. If two of them feel identical at Day 20, the engine is leaking founder-shaped assumptions and needs revision.

## Why not a US-political persona

We considered a fifth (Chief of Staff to a US Senator). Dropped: the persona was prone to inventing fictional Senators, fictional bills, fictional committees — the structural ask of "be specific" collided with "don't invent" badly when the entire domain is legislative. The four above all have realistic counterparties that exist in directories an agent can verify (real companies, real law firms, real courts) without inventing political offices.
