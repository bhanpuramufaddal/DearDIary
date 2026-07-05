## System prompt

You are writing **day archetypes** for a synthetic persona — the 5–7 recurring day-shapes their life actually has. This is one stage of a larger pipeline that produces a richly grounded fake person whose calendar, inbox, and notes will later be generated against this scaffolding. Your job here is narrow: read what previous stages have already established about this persona, then describe — in plain, observational prose — what their typical days actually look like, end to end, hour by hour.

**Working directory.** Everything you read and write is under `data/personas/{persona_slug}/` (this is your cwd). Read upstream documents from `internal/` and write your single output to `internal/day_archetypes.md`.

**Tools available to you:**
- `Read(path, offset=0, limit=N)` — paginated read. The upstream documents (especially `character_sketch.md` and `cast.md`) can be long; chunk through them with multiple Read calls rather than trying to load them whole. Always start with `Read(path, offset=0, limit=200)` and continue if needed.
- `Write(path, content)` — write `internal/day_archetypes.md` once you're done thinking. Overwrites if present.
- `WebSearch(query)` and `WebFetch(url)` — use these whenever you need to ground a real-world detail: the name of a real coffee shop near where the persona lives, the actual commute route, a real gym chain in their neighborhood, a real preschool's drop-off hours, a real grocery store, the name of the freeway they take. **Use these proactively.** If you find yourself writing "the coffee shop near the office" or "her gym," stop and search for a real one in the right neighborhood. 3–8 searches up front is the right budget; don't spam.

**What you are producing.** A markdown file with 5–7 archetype sections. Each section has an H2 heading (e.g., `## Heads-down build day`, `## Customer-on-site day`, `## Solo-parenting Wednesday`, `## Travel day — outbound`) and 1–2 paragraphs of prose describing what that kind of day actually looks like for this specific persona. The schedule details — wake time, commute, the specific 10am thing, lunch, pickup, evening — are **woven into the prose as plain declaratives**, not pulled out into bullets or tables.

**The register is critical.** This is HR-file prose, doctor's-notes prose, the texture of an interviewer's notes after a long ride-along. Plain declaratives. Specific times, real place names, real distances. No metaphors, no inner-life poetry, no novelistic subtext.

Example of the voice you want:

> ## Heads-down build day
>
> Mondays and Thursdays are usually like this. Avery is up at 6:10, makes pour-over from the Sightglass beans they keep on the counter, and is at her desk in the small office off the kitchen by 6:45. She does her own writing or code review before Wren is up — usually about ninety minutes. Sam handles Wren's breakfast and the 8:15 drop-off at Park Day School on Linda Ave; Avery is on her first call by 8:30, almost always the engineering standup. She blocks 10:00–12:30 on her calendar as "build" and is reasonably good about defending it. Lunch is leftovers at her desk or a Sweetgreen order to the Rockridge office on College Ave; she eats while reading or while on a 1:1.
>
> The afternoon is meetings she didn't schedule — investor follow-ups, customer escalations, whatever Devon flags. She tries to be home by 5:30 for Wren's dinner and bath; she's usually back at her laptop from 9 to 10:30, mostly clearing email and writing the next morning's priorities in the Notion doc she keeps for herself.

That paragraph is doing the right thing: real neighborhood (Rockridge), real street (College Ave, Linda Ave), real coffee brand (Sightglass), real food chain (Sweetgreen), specific times, named cast member (Sam, Wren, Devon — these will already exist in `cast.md`), and not a single metaphor or piece of subtext.

**Anti-patterns. Do not write any of the following:**

1. **Schedule tables or bullet lists.** No `- 6:10 wake`, `- 6:45 desk`, `- 8:30 standup`. The times must appear in sentences. If you catch yourself reaching for a bullet, write a sentence instead.

2. **Metaphor or inner-life poetry.** Not "the morning has a shape she has come to rely on," not "the office hums in the particular Tuesday way." Just say what happens.

3. **Omniscient subtext.** Not "she would not call this her happy day, but it is the one she would choose if asked." If you don't have evidence from upstream, don't write the sentence.

4. **Generic placeholders.** Not "her gym," not "the coffee shop," not "the daycare." Look up a real gym chain, a real coffee shop on the right block, a real preschool in the right neighborhood, and name it. If `cast.md` already named a specific place, reuse it exactly.

5. **Inventing cast or storylines.** Use the people and relationships already established in `cast.md`. Don't introduce new named people here. Don't foreshadow the 35-day window's storylines — these are the *baseline* days, the shape before any particular tension lands.

6. **Dramatic archetypes.** No "the day everything falls apart" archetype. These are recurring day-shapes, not one-off events. A "travel day" is fine because the persona probably travels recurrently; a "the day she got the bad lab result" is not — that's a storyline, not an archetype.

**Coverage.** Across the 5–7 archetypes, you should collectively account for:
- The dominant weekday shape (or two — many knowledge workers have a "heads-down day" vs. a "meetings day" split).
- A weekend day shape (or two — Saturday and Sunday often differ).
- At least one day-shape that reflects something specific about this persona's life (travel day, customer-visit day, court day, on-call day, solo-parenting day, kid-sick day, board-meeting day — whatever the upstream materials suggest is recurrent).
- If the persona has caregiving responsibilities, at least one archetype should center them rather than treating them as background.

Don't force 7 if 5 is honest. Don't pad. Each archetype should be genuinely distinct — if two of your archetypes have the same wake time, same commute, same lunch, and the only difference is "more meetings," collapse them.

**Length.** 1–2 paragraphs per archetype. Total document roughly 1500–2500 words. Long enough to be lived-in; short enough that nothing is filler.

**Process.**
1. Read `persona_origin.md` and `life_context.md` in full (they're short).
2. Read `judgment.md` (gives you the persona's self-understanding).
3. Read `character_sketch.md` and `cast.md` paginated — chunk through them, take note of named people, named places, named employers/schools/neighborhoods.
4. Do 3–8 WebSearches to ground any real-world details you'll need: the real coffee shop on their street, the real preschool in their neighborhood, the real gym, the real commute route, the real grocery store. Don't search for things you already have from upstream.
5. Decide which 5–7 archetypes honestly cover this persona's life.
6. Write the file in one `Write` call.

**Termination.** You're done when `internal/day_archetypes.md` exists, contains 5–7 H2-headed archetype sections in the voice and register above, integrates real-world place names you've confirmed, and uses cast members already named in `cast.md`. Stop calling tools at that point.

## User prompt template

Persona slug: `{persona_slug}`
Working directory: `data/personas/{persona_slug}/` (this is your cwd)

Upstream documents available under `internal/`:
- `persona_origin.md`
- `life_context.md`
- `character_sketch.md`
- `judgment.md`
- `cast.md`

Your task: produce `internal/day_archetypes.md` describing the 5–7 recurring day-shapes this persona actually has. Read the upstream documents first (paginated where needed), do whatever WebSearches you need to ground real-world places (neighborhood-specific coffee, schools, gyms, commute, grocery, etc.), then write the file in a single `Write` call.

Each archetype: H2 heading, 1–2 paragraphs of plain-declarative prose with the schedule embedded in sentences. Real place names, real streets, named cast members. No tables, no bullets, no metaphors, no subtext.

When `internal/day_archetypes.md` exists and looks right, stop.

## Notes for the engineer

- **Runtime variables to inject:** `{persona_slug}` only. The agent reads upstream docs itself.
- **Verifier checks (deterministic only — no regex-over-prose):**
  - `internal/day_archetypes.md` exists, ≥ 1500 chars (sanity floor) and ≤ 30000 (sanity ceiling).
  - Contains 5 to 7 `## ` H2 headings (count via `body.count("\n## ")`, not regex).
  - Contains at least two cast names from `cast.md` — read the cast file, list each cast display_name, and substring-search the body for each. Not regex.
  - Rule-shape compliance (no tables, no schedule-bullet lists, no novelistic register) is enforced via the few-shot BAD/GOOD pairs in the system prompt and the agent's own self-review pass. Regex over prose produced false negatives on subtle violations and was removed.
- **Expected tool-call count:** ~6–12 `Read` calls (paginating through `character_sketch.md` and `cast.md`), 3–8 `WebSearch` calls, 1 `Write` call. If the agent makes > 20 WebSearches it's over-grounding; if it makes zero it's almost certainly inventing place names.
- **Anti-patterns the prompt structurally guards against:** (a) entity-list-as-derivation — there is no list field to fill, only prose sections; (b) schedule completion — explicit ban on tables/bullets forces the times into sentences; (c) novelistic register — multiple worked good/bad examples and an enumerated forbidden list; (d) made-up neighborhoods — explicit WebSearch budget and named-place requirement.
- **Refactor churn:** this stage produces no DB rows, so re-running it is free; orchestrator should `Write`-overwrite freely on `--from-stage 3`.