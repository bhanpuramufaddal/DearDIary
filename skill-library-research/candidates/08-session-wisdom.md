# Candidate #8 — This session's accumulated wisdom

The "candidate I already wrote." These are patterns surfaced or refined in the digest-agent work itself — sources live in `prompts/disposition.md`, `prompts/playbook/discipline/*.md`, `prompts/playbook/plays/*.md`, `prompts/seed-plays/howto-*.md`, `src/main/prompts/{mind,diaryAgent,coldStartAgent}*.ts`, `src/main/telemetry/langfuse.e2e.test.ts`, and `MEMORY.md → feedback_no_fallbacks.md`. They're patterns specific to *agentic systems* — what changes when the prompt isn't a one-shot but the source-of-truth for an autonomous loop.

## Moves worth keeping

1. **Epistemic vs deontic distinction.**
   Don't conflate "what the model expects" (epistemic — calibrated beliefs, predictions) with "what the principal must do today" (deontic — open loops, the agenda). Borrowing the epistemic structure for the deontic question is the bug. *Source: the A2 reframe in `prompts/playbook/discipline/selection.md` — "Predictions are understanding, not agenda."* Few outside-canon prompt frameworks even surface this — it shows up only when you've built an agent whose perception layer is separate from its composition layer.

2. **Open loops over enumerated obligation types.**
   When "due-ness" matters, define one general primitive (the open loop: "next move is the principal's and it can't keep waiting") and let the agent reason. Enumerating obligation types (deadlines, RSVPs, "by Friday", overdue replies, scope questions…) forces a forever-growing taxonomy. *Source: same A2 reframe — `discipline/selection.md`'s "Start from open loops" section.*

3. **Worked-examples-over-rules (and the "skill, not willpower" insight).**
   When an agent fails to do something it "knows about," the failure is usually a missing pattern-recognition skill, not insufficient discipline. Don't strengthen the imperative — show worked examples of the cognitive move. *Source: the cold-start derived-zero-plays bug. Forcing "you MUST insert ≥6 plays" would have produced bad plays; seeding `howto-situation-handling.md` / `howto-voice.md` / `howto-suppression.md` taught the abstraction move and lifted derivation from 0 → 11.*

4. **Loud failure / no fallbacks.**
   Hate-and-remove silent fallbacks. Throw on missing config, missing files, ambiguous input. Don't "guess at a default." *Source: `MEMORY.md → feedback_no_fallbacks.md`.* This is the user's standing directive — the strongest single signal in the whole repo. Applies to both code AND prompts: don't write defensive prompts that paper over uncertainty; surface it.

5. **Forbidden-vocabulary section.**
   Explicit list of words the agent must never use in principal-facing prose because they leak agent architecture: `tick`, `the page`, `the digest`, `substrate`, `anchor`, `case_base`, `thinking layer`, `cold-start`, `mind agent`. *Source: `src/main/prompts/diaryAgentPrompt.ts` voiceBlock.* This is a hard pattern other libraries don't surface — most prompt frameworks teach voice; few teach *which exact words must not appear*.

6. **Inner-mode vs outer-mode voice register.**
   Same agent, different surfaces, different voices. Working surfaces (anchor layers, thinking journals): verbose, evidence-anchored, show your work, cite case_base. Presentation surfaces (speech-layer prose, drafted components): brief, polished, conclusions-only. *Source: `prompts/disposition.md` "Voice register" section.* The discipline is that the working voice is **wrong** in presentation, and vice versa — they're not graded versions of each other.

7. **Reasoning Theater warning.**
   "Terse expert voice on working surfaces produces intuition-mimicry without intuition." A `fast` layer that reads like a polished summary is *wrong*. Working surfaces stay verbose. *Source: `prompts/disposition.md`.* This is a distinctive anti-pattern — naming the failure mode where an agent produces *sounds*-like-judgment without underlying judgment.

8. **Profile-as-guideline, not authority.**
   When the principal's self-account (profile.md) conflicts with observed behavior, observed wins AND surface the contradiction. Don't silently override. *Source: `prompts/playbook/voice/principal*` and the disposition's "When profile.md and substrate disagree" section.*

9. **Discipline docs over rule lists.**
   Each discipline doc (suppression, honesty, selection) is structured: **principle + why-it-matters + how-to-apply + worked example + anti-patterns**. Not a checklist; not a regulation. An essay teaching a discrete competence. *Source: `prompts/playbook/discipline/*.md`.* The shape transfers — every pattern in the prompt-writing skill should follow it.

10. **Lean orchestrator + modular references on-demand.**
    The role prompt teaches *process, not vocabulary*; depth lives in modular reference docs the agent reads as needed. *Source: `src/main/prompts/diaryAgentPrompt.ts` — "The detailed rules live in `prompts/playbook/`. You read them on demand via `read_playbook_section`."* Matches Anthropic's progressive disclosure but applied to PROMPT structure, not skill structure.

11. **Verify output mapping empirically.**
    Don't trust documentation for what an input field becomes on the output. Round-trip every claimed input→output mapping through the real API/system, assert against the actual response. *Source: `src/main/telemetry/langfuse.e2e.test.ts` — caught that the default `LangfuseSpanProcessor` silently drops non-LLM spans, that span name doesn't become trace name, that snake_case attribute names map to camelCase outputs.*

12. **Categorical generalization over enumeration.**
    Same insight as #2 generalized: when a rule would otherwise need to enumerate cases, look for the one general definition that subsumes them. *Source: also `discipline/selection.md`* + the seeded `howto-suppression.md` ("generalize the class, not the senders").

13. **Source-of-truth = real artifacts, never invented.**
    "Cite REAL source_ids from the events table, never invent them. A citation that doesn't resolve is worse than no citation." *Source: `discipline/selection.md` + `discipline/honesty.md`.* General pattern: when grounding evidence matters, fabrication is a hard fail — better to drop the claim or mark it uncertain.

14. **The agent's architecture must never leak into its system prompt.**
    Closely related to forbidden vocab but more general: avoid words like `dispatcher`, `MCP`, `tool call`, `prior`, `efference` — all internal to the system, none meaningful to the principal. *Source: `diaryAgentPrompt.ts` voiceBlock.*

## Distinctive contribution

The eight-candidate survey above (1–7) covers the canon: progressive disclosure, framework taxonomies, SKILL.md structure, decision trees, conciseness. This session's contribution is everything that becomes visible only once you've built **an autonomous loop** — the epistemic/deontic split, the skill-not-willpower diagnosis for missing cognitive moves, the working-vs-presentation voice register, the architecture-doesn't-leak rule, and the empirical-verification-over-documentation discipline.
