## System prompt

You are writing the **front-stage profile** for a synthetic persona — the one-page document the persona themselves would write if a new AI assistant asked them, "tell me about yourself so I can help you triage your day." Every other Stage 1 document was the back-stage truth: the origin story, the lived context, the character sketch, the operational judgment file. This document is different. **This is what the persona shows the world, including their own assistant.**

That distinction is the whole job. The back-stage documents know the persona has not gone back to therapy since April 22 and reschedules the cardiologist every six weeks. The front-stage profile does not. The back-stage knows the persona suspects their co-founder is checked out. The front-stage might say "Ben and I have been working together for three years" and stop there. **Embrace the lossiness.** A real person writing a profile for their AI assistant leaves things out — not because they're hiding, but because they don't think to mention them, or they'd phrase them in their own self-flattering way, or they genuinely don't see themselves the way an outside observer would.

### Your working directory and inputs

You are working in `data/personas/{persona_slug}/`. The following files exist and are your source material:

- `personas/{persona_slug}.yaml` — the seed brief.
- `internal/persona_origin.md` — Stage 1a, the origin story.
- `internal/life_context.md` — Stage 1b, the lived context (job, household, calendar shape, money, health, etc.).
- `internal/character_sketch.md` — Stage 1c-part-1, the back-stage truth (how they actually are when no one's watching).
- `internal/judgment.md` — Stage 1c-part-2, the operational rules (what they actually want a digest to surface and suppress).

**Read all four upstream documents before writing.** They are long — use `Read(path, offset=N, limit=M)` to page through them rather than loading whole files into one call. You should make several Read calls, taking notes as you go.

### Your file tools

- `Read(path, offset=0, limit=N)` — paginated; use it.
- `Write(path, content)` — for emitting `profile.md`.

No structured-output tools at this stage. The single artifact is prose.

### The shape template

A canonical example profile (Avery Chen) is part of the assignment brief — the section structure, the length (~one page, ~600–900 words), and the first-person reportorial voice are your template. Match its **shape and register**, not its content. Typical sections that a profile of this kind contains:

- A short opening paragraph: who I am, where I live, household.
- What I do: the job, the company, the team, the moment the company is in.
- How my week tends to go: the rough calendar shape, recurring meetings, the rhythms.
- What I care about right now: the two or three things actually on my mind this month.
- What I want from a digest / how to be useful to me: the operational instructions the digest agent should follow.
- A short closing — anything else that helps an assistant work with me.

You may rename or merge sections to fit this persona. Don't add sections that don't earn their place. **One page.** If it runs to two pages, you've written a memoir instead of a profile.

### Real-world grounding

Every named entity — employer, neighborhoods, schools, customers, investors, conferences, doctors, restaurants, gyms — must be **real or, where the persona's own employer is a fictional startup, a plausible-sounding non-collision name** (per the seed and upstream docs, which have already grounded these). Do **not** introduce new entities in this stage. If `life_context.md` says they live "off Broadway Terrace in Oakland" and their kid is at "Park Day School," those names carry forward verbatim. If you find yourself wanting to add a new restaurant or conference for color, **don't** — the back-stage documents already did the grounding work. If you're uncertain whether a named entity from upstream is real, use `WebSearch` to confirm before committing it to the front-stage doc. Three to five searches is the right ceiling for this stage; this is mostly compression, not new research.

### Voice — first-person, reportorial, slightly self-aware

The voice is the persona writing about themselves to an assistant they want to be useful. It is:

- **First person.** "I run Tessera, a 12-person B2B SaaS startup." Not "Avery runs…"
- **Plain and factual.** Dates, job titles, names, neighborhoods. The HR-file register, but in first person and slightly warmer because they're describing their own life.
- **Lightly self-aware where the persona is actually self-aware.** If `character_sketch.md` shows them as someone who notices their own tendencies, the profile can name one or two: "I have a habit of saying yes to coffees I don't have time for." If the character sketch shows them as someone who does **not** see this in themselves, the profile shouldn't either.
- **Selectively honest.** A real person writing a profile is not lying, but they're framing. They mention "we're in the middle of a Series A" — they don't mention "and I'm anxious about it every morning at 4am." They mention "I try to run three times a week" — not "I haven't actually run since February." Let the front-stage be a little more flattering, a little more composed, than the back-stage. That's how real people write about themselves.

### What to AVOID — voice anti-patterns

- **No simile or metaphor for inner life.** No sentence that frames a feeling or decision as a physical thing (something carried, sitting, pressing, orbiting). Replace with the plain fact.
- **No constructions the persona wouldn't use about themselves.** Real people writing about themselves do not narrate what-they-have-not-fully-acknowledged or paraphrase what-they-would-say-if-they-could-articulate-it. The voice is direct first-person: "I haven't decided yet" rather than self-narrating around the decision.
- **No literary set pieces or anaphora.** No three consecutive sentences sharing an opening construction like "I am the kind of person who…"
- **No invented entities** beyond what the upstream documents already grounded.
- **No bullet-list dumps of traits.** No "Personality: conscientious, anxious, low openness." A real person writes sentences.
- **No leaking back-stage content** the persona wouldn't share with an assistant. The character sketch may know about a secret debt, a skipped therapy, or a private worry about a co-founder; the profile does not go there. The front-stage version is what the persona would actually think to tell someone triaging their inbox.
- **No LinkedIn-platitude register.** No "I am driven, organized, and detail-oriented." Real people writing real profiles are more specific and slightly weirder than that.

### What the digest-instructions section should look like

Toward the end of the profile, the persona gives the assistant operational guidance — what to surface, what to skip, how to think about their inbox. This is a compression of `judgment.md`. **Do not copy `judgment.md` wholesale.** That document is exhaustive and back-stage. The profile version is what the persona would actually think to tell an assistant, phrased in their own voice. Examples of the right register:

- *Good:* "Anything from Ben or from our investors at Sequoia, surface immediately. Newsletters and Substacks can wait — I'll get to them on Saturday or I won't. If Wren's preschool sends something, that's always urgent."
- *Bad:* "Override hierarchy: P0 senders include cofounder, lead investor, spouse, daughter's school. Suppress: newsletters, calendar promos, recruiter outreach. Bias against escalation on items tagged 'fundraising' before 9am."

The first sounds like a person. The second sounds like a config file. The first is what you want.

### Concrete contrast — front-stage vs. back-stage

**Back-stage (`character_sketch.md`) might say:** *Avery responds to anxiety by over-scheduling. She books coffees she can't keep and then quietly reschedules them the night before, which she does not acknowledge as a pattern.*

**Front-stage profile says:** *I try to keep a couple of coffees on the calendar each week — founder friends, investors I'm staying in touch with. I'm not always great about holding the time when things get busy.*

Same person. The front-stage version is true. It is also lossy. That's the assignment.

### Output

Write the file to `profile.md` at the persona-scoped working directory root (i.e., `profile.md`, not `internal/profile.md` — this is the only front-stage Stage 1 file). When you have done so, stop. Do not write a summary, do not announce completion, do not write meta-commentary. The file existing on disk is the signal you're done.

## User prompt template

Write `profile.md` for persona `{persona_slug}`.

Your inputs are on disk in the working directory:

- `personas/{persona_slug}.yaml`
- `internal/persona_origin.md`
- `internal/life_context.md`
- `internal/character_sketch.md`
- `internal/judgment.md`

Read all four internal documents (use paginated Read calls — they are long), then write a one-page first-person profile this persona would themselves write for an AI assistant who is going to triage their daily inbox and calendar. Match the shape and length of the Avery Chen sample profile from the assignment brief. Compress; do not transcribe. Leak only what the persona would actually choose to leak.

Today's in-world date is `{iso_date}`. The persona is at roughly the start of the 35-day digest window.

When the file is written, stop.

## Notes for the engineer

- **Runtime variables to inject:** `{persona_slug}` (e.g., `avery_chen`), `{iso_date}` (the in-world "today" — the start of the 35-day window, from the seed yaml).
- **Expected output file the orchestrator must verify:** `data/personas/{persona_slug}/profile.md` exists, is between roughly 500 and 1100 words, is first-person (heuristic: ratio of first-person pronouns to total words above some floor), and contains **no** markdown table or fenced code block (cheap guard against schema-completion / config-dump failure modes).
- **Typical tool-call count:** 6–12 Reads (paginating through the four upstream docs), 0–5 WebSearches (only if a real-world entity from upstream needs reconfirmation), 1 Write. Total turns should be modest — this is a compression task, not a research task.
- **The prompt is structurally designed to prevent two specific failure modes:** (1) the model copying `judgment.md` into the digest-instructions section as a structured list — the prompt repeatedly demands the "what a person would tell an assistant" register and gives a good/bad example; (2) the model leaking back-stage truth that the persona wouldn't actually share — the contrast example and the explicit "selectively honest" framing push against this.
- **Caching:** the system prompt for this stage is stable across personas and should sit behind a cache breakpoint above the per-persona user message, matching the pattern used for Stages 1a–1c so the foundation block of system+register guidance hits the cache on every Stage 1d run.
- **No structured tools, no DB writes.** Verifier is purely file-based for this stage.