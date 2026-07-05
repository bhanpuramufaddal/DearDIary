# Synthesis — keep / adapt / skip across 8 candidates

Eight candidate sources surveyed in `candidates/01..08`. This doc collapses them by theme (not by candidate, since the most-valuable moves were corroborated across multiple sources) and assigns a verdict per move. Anything **KEEP** / **ADAPT** becomes content in Phase B (the library at `~/.claude/skills/prompt-writing/`).

Verdict glossary:
- **KEEP** — vendor close to verbatim (with attribution if licensed). High-quality, well-stated, no surface improvement obvious.
- **ADAPT** — strong idea, but rewrite to fit our voice / merge with another source / strip theatrics.
- **SKIP** — bloat, generic, contradicted by other (more credible) sources, or covered better elsewhere in our KEEP list.

Each move cites its source(s) by candidate number (`01`..`08`).

---

## 1. Skill structure & layout

| # | Move | Source | Verdict |
|---|---|---|---|
| 1.1 | **Three-tier progressive disclosure**: frontmatter (always loaded) → SKILL.md body (on trigger) → `references/` / `scripts/` / `examples/` / `agents/` (when SKILL.md instructs) | 01, 02, 06, 07 | **KEEP** — corroborated by every source. The load-bearing structural principle. |
| 1.2 | **SKILL.md as router, not manual**: sub-500-line ceiling; first section is a decision tree or pre-flight gate; happy path lives elsewhere | 01, 02 | **KEEP**. |
| 1.3 | **10KB hard cap on SKILL.md** + "SKILL.md is the workflow, references/ is the knowledge base" verbatim framing | 07 | **KEEP**. |
| 1.4 | **Frontmatter schema in practice: just `name` + `description` (+ optional `license`)**, despite the guide PDF documenting more fields (`metadata:`, `allowed-tools:`, `compatibility:`) that the 17 official skills don't use | 01, 02 | **KEEP the discrepancy itself** — vendor only what real skills actually use. The PDF's wider schema is **SKIP**. |
| 1.5 | One-file-per-framework split (`references/frameworks/<name>.md`) + separate `assets/templates/<name>.txt` skeletons | 03 | **KEEP** — clean separation we'll need once we have ~7 frameworks. |
| 1.6 | `scripts/` directory for deterministic checks (stdlib-only Python; CLI-first; `--help` is the contract; JSON-out) | 01, 07 | **KEEP** — useful future seat for prompt-evaluator/debugger scripts. |
| 1.7 | "Black-box scripts beat prose for deterministic checks" — *"Code is deterministic; language interpretation isn't."* | 01 | **KEEP** as a one-line guiding principle. |

## 2. The description (frontmatter) — trigger discoverability

| # | Move | Source | Verdict |
|---|---|---|---|
| 2.1 | **Description formula = What + When + Key capabilities**; be deliberately "pushy" to combat under-triggering; add explicit **negative triggers** ("Do NOT use for…") to fix over-triggering | 01 | **KEEP** — the highest-value single insight from the Anthropic guide. |
| 2.2 | Debug a description by asking Claude to quote it back ("when should this skill activate?") | 01 | **KEEP** — cheap verification ritual. |
| 2.3 | **Proactive Triggers** section + **Related Skills** section with WHEN/NOT disambiguation against other skills in the library | 07 | **KEEP** — turns passive skills active and prevents trigger cannibalization as the library grows. |
| 2.4 | Frontmatter description target length ~100 words | 06 | **ADAPT** — use as an upper bound. Most descriptions should be shorter. |

## 3. Authoring process (how a new skill gets written)

| # | Move | Source | Verdict |
|---|---|---|---|
| 3.1 | **Six-step authoring order** (chindden): examples → resource plan → scaffold → bodies → validate → ship | 06 | **KEEP** — explicit and order-dependent. Most authors invert steps 2 ↔ 4 and end up rewriting. |
| 3.2 | **Iterate on one hard case before broadening**; three test layers — Triggering / Functional / Performance-vs-baseline | 01 | **KEEP**. |
| 3.3 | Apply the skill *to itself* once authored — self-consistency check | 08 | **KEEP**. (Was already in our plan; corroborated as a sound discipline.) |

## 4. Framework taxonomy (the prompt-engineering canon)

Prompt Architect ships **27 frameworks across 7 intent categories**, not just the 7 named ones. The 7 named ones (CO-STAR / RISEN / RISE / TIDD-EC / RTF / CoT / CoD) are the most-cited and all **vendor-keepable verbatim** under MIT.

| # | Framework | Source | Verdict |
|---|---|---|---|
| 4.1 | **CO-STAR** (Context / Objective / Style / Tone / Audience / Response) | 03 | **KEEP verbatim** — audience+tone is the highest-value piece. |
| 4.2 | **RISEN** (Role / Instruction / Steps / End-goal / Narrowing) | 03 | **KEEP verbatim** — the cold-start prompt already uses this. |
| 4.3 | **RISE** (Role / Input / Steps / Expectation) | 03 | **ADAPT** — slightly weaker than RISEN; merge or include as a lighter alternative. |
| 4.4 | **TIDD-EC** (Task / Instruction / Do/Don't / Examples / Context) | 03 | **KEEP verbatim** — the explicit Do/Don't slots are the unique value. |
| 4.5 | **RTF** (Role / Task / Format) | 03 | **KEEP verbatim** — the minimal framework; useful as the default. |
| 4.6 | **CoT** (Chain-of-Thought) | 03 | **KEEP verbatim** — with the Prompt Master caveat: don't apply CoT to reasoning-native models. |
| 4.7 | **CoD** (Chain-of-Density) | 03 | **KEEP verbatim**. |
| 4.8 | **Intent-category routing then framework** (7 categories: RECOVER / CLARIFY / CREATE / TRANSFORM / REASON / CRITIQUE / AGENTIC) + decision tree | 03 | **KEEP** — vendor wholesale. Becomes the primary user-facing routing in SKILL.md. |
| 4.9 | Bonus tier worth grabbing: BAB, APE, ReAct, Self-Refine, Pre-Mortem, Devil's Advocate, Step-Back, Plan-and-Solve, RPEF, Reverse-Role | 03 | **ADAPT** — pick 3–4 highest-value (Self-Refine, Pre-Mortem, Step-Back are strong) for a "supplementary frameworks" file. |

## 5. Decision / routing logic

| # | Move | Source | Verdict |
|---|---|---|---|
| 5.1 | **Tool-detection BEFORE framework selection** — invert the usual flow; routing to Claude vs. o3 vs. Midjourney matters more than acronym choice | 04 | **KEEP** — non-obvious and high-value. Frame as the first step in the SKILL.md decision tree. |
| 5.2 | Hard rules / anti-techniques: no CoT on reasoning-native models; banned high-fabrication techniques | 04 | **KEEP verbatim** as an explicit "Anti-Patterns" section. Strip Prompt Master's theatrical "PRIMACY ZONE / Hard Rules" framing. |

## 6. Voice & register patterns (where this session's wisdom dominates)

| # | Move | Source | Verdict |
|---|---|---|---|
| 6.1 | **Inner-mode vs outer-mode voice**: same agent, different surfaces, different rules. Working surfaces verbose + evidence-anchored; presentation surfaces brief + conclusions-only | 08 | **KEEP** — unique to this session. |
| 6.2 | **Reasoning Theater warning** — "terse expert voice on working surfaces produces intuition-mimicry without intuition" | 08 | **KEEP** — distinctive anti-pattern, well-named. |
| 6.3 | **Forbidden vocabulary section** — explicit list of words that must not appear in principal-facing prose (agent jargon, internal architecture terms) | 08 | **KEEP** — strong and concrete. Most prompt frameworks teach voice but few teach "these exact words must not appear." |
| 6.4 | "The agent's architecture must never leak into its system prompt" | 08 | **KEEP** as a one-line guiding principle in a Voice pattern doc. |
| 6.5 | Anthropic skills repo tone — casual, theory-of-mind explanation over hammered MUSTs | 02 | **KEEP** as an aesthetic guideline (avoid "MUST" / "ALWAYS" floods in our patterns). |

## 7. Discipline / agentic patterns (this session, distinctive)

These don't show up in candidates 01–07. They're visible only once you've built an autonomous loop.

| # | Move | Source | Verdict |
|---|---|---|---|
| 7.1 | **Epistemic vs deontic distinction** — predictions are calibrated beliefs (epistemic), not a to-do list (deontic). Don't borrow epistemic structures for deontic questions | 08 | **KEEP** — high-value pattern, distinct. |
| 7.2 | **Categorical generalization over enumeration** — when a rule would otherwise enumerate cases, find the one general definition that subsumes them | 08 | **KEEP**. |
| 7.3 | **Open loops over obligation taxonomies** — derive what's "due today" from one general primitive (ball-in-court + horizon), not a taxonomy | 08 | **KEEP**. |
| 7.4 | **Worked-examples-over-rules / skill-not-willpower** — when an agent fails to do something it "knows about," the failure is a missing pattern-recognition skill, not insufficient discipline; show worked examples of the move | 08 | **KEEP** — the load-bearing diagnostic. |
| 7.5 | **No fallbacks / loud failure** — throw on missing config, ambiguous input, anything underspecified. Applies to code AND prompts | 08 (your standing directive) | **KEEP** — non-negotiable per `MEMORY.md`. |
| 7.6 | **Profile-as-guideline, not authority** — when self-account conflicts with observed behavior, observed wins AND surface the contradiction | 08 | **KEEP**. |
| 7.7 | **Discipline docs over rule lists** — each pattern doc structured as principle + why + how-to-apply + worked example + anti-patterns. Not a checklist; an essay teaching a competence | 08 | **KEEP** — this becomes the structural template for every `patterns/*.md` file in Phase B. |
| 7.8 | **Lean orchestrator + modular references on-demand** — role prompt teaches process not vocabulary; depth lives in modular reference docs read by the agent as needed | 08 | **KEEP** — same idea as 1.1/1.2 applied to PROMPT structure (not skill structure). |
| 7.9 | **Source-of-truth = real artifacts, never invented** — cite real ids, never fabricate. A citation that doesn't resolve is worse than no citation | 08 | **KEEP**. |

## 8. Verification & testing

| # | Move | Source | Verdict |
|---|---|---|---|
| 8.1 | **Verify output mapping empirically** — round-trip every claimed input→output through the real API; treat documentation as a hypothesis, not truth. (e.g., the LangfuseSpanProcessor silently-drops-non-LLM-spans discovery) | 08 | **KEEP** — distinctive and battle-tested. |
| 8.2 | Three test layers (Triggering / Functional / Performance-vs-baseline) | 01 | **KEEP**. |
| 8.3 | "Iterate on one hard case before broadening" — cheaper signal than wide-shallow testing | 01 | **KEEP**. |

## 9. Anti-patterns to surface explicitly

| # | Move | Source | Verdict |
|---|---|---|---|
| 9.1 | Defensive prompting / hedging-by-default | 01 (implicit), 08 | **KEEP** as an explicit anti-pattern doc. |
| 9.2 | CoT applied to reasoning-native models | 04 | **KEEP** — already in Hard Rules above. |
| 9.3 | Bloated SKILL.md (>10KB, manual-shape rather than router-shape) | 02, 07 | **KEEP**. |
| 9.4 | Pasting one verbatim example as the whole "few-shot" — generalize the shape, paste an excerpt for flavor | 08 (from `howto-situation-handling.md`) | **KEEP**. |
| 9.5 | Theatrical "PRIMACY ZONE / Hard Rules" framing | 04 | **SKIP** — Prompt Master's voice is wrong for our library. Strip and rewrite. |
| 9.6 | The Anthropic guide PDF's recommended SKILL.md template (Examples / Troubleshooting / Error-handling boilerplate) — not followed by their own 17 real skills | 01 vs 02 | **SKIP** the template; **KEEP** the lesson that templates published by the same source can diverge from practice. |

## 10. License notes

- **Prompt Architect**: MIT, vendor-OK with attribution.
- **Prompt Master**: MIT, vendor-OK with attribution. **Strip theatrics** when vendoring.
- **alirezarezvani/claude-skills**: MIT, lift freely with attribution.
- **ClawHub Prompt Engineering Expert**: metadata-only page; nothing fetched to vendor.
- **ClawHub Skill Creator**: MIT-0 (effectively public domain).
- **anthropics/skills**: read for patterns; don't vendor verbatim (their style; we adopt the *shape*, not their text).

---

## Recommended Phase B library shape

Based on the KEEP list above:

```
~/.claude/skills/prompt-writing/
  SKILL.md                                # router, ~5KB, decision tree first
  references/
    frameworks/                           # 4.1–4.7 verbatim (vendored, attributed)
      co-star.md  risen.md  rise.md
      tidd-ec.md  rtf.md
      chain-of-thought.md  chain-of-density.md
    frameworks-supplementary/             # 4.9 — 3-4 picks, ADAPTed
      self-refine.md  pre-mortem.md  step-back.md
    routing/                              # 4.8 + 5.1 + 5.2
      tool-detection-first.md             # 5.1
      intent-categories-and-tree.md       # 4.8
      hard-rules-anti-techniques.md       # 5.2
    patterns/                             # Section 7 — this session's wisdom
      epistemic-vs-deontic.md
      categorical-over-enumeration.md
      open-loops-not-taxonomies.md
      worked-examples-over-rules.md
      no-fallbacks-loud-failure.md
      profile-as-guideline.md
      discipline-docs-over-rule-lists.md
      lean-orchestrator-modular-refs.md
      real-source-no-fabrication.md
    voice/                                # Section 6
      inner-vs-outer-register.md
      reasoning-theater-warning.md
      forbidden-vocabulary.md
      architecture-doesnt-leak.md
    structure/                            # Section 1 + 2
      progressive-disclosure.md
      skill-md-as-router.md
      description-formula.md              # 2.1 + 2.2 + 2.3
    verification/                         # Section 8
      verify-output-mapping-empirically.md
      three-test-layers.md
      iterate-one-hard-case-first.md
    anti-patterns/                        # Section 9 (positive contrasts live in patterns/)
      defensive-prompting.md
      pasted-verbatim-example.md
      bloated-skill-md.md
    examples/                             # 2-3 worked BEFORE/AFTERs from this session
      diary-step3-predictions-as-agenda.md
      cold-start-step9-derive-plays.md
      diary-dedup-column-name.md
  scripts/                                # reserved seat per 1.6/1.7; empty for now
```

`SKILL.md` body opens with: (a) tool-detection question (5.1), (b) intent category routing (4.8 decision tree pointing at `frameworks/`), (c) two-line summary of voice register + forbidden vocab (linking to `voice/`), (d) the "apply skill to itself" verification ritual (8.x). Total ~5KB.

## Future-seat skills (planned, not built here)

- `skill-creator/` — distill from candidate 06 (chindden) — the six-step authoring order is the spine.
- `prompt-debugger/` — diagnose why a prompt isn't producing the desired behavior; lifts the "ask Claude to quote the description back" debug ritual (2.2).
- `prompt-evaluator/` — rubric-driven before/after eval; first script in `scripts/` lands here.

## Open items before Phase B

1. **License attribution format** — agree on a one-line "Adapted from <project> (MIT) — <url>" at the top of each vendored framework doc.
2. **Where to commit** — `~/.claude/skills/` is the operational install; a sibling git repo (`~/Projects/skill-library/`) symlinked or copied from is the version-controlled source. Decide before authoring.
3. **Re-fetch Prompt Master verbatim** — agent reported WebFetch refused due to "instruction injection" framing. May need a manual grab if specific phrasings turn out to matter; mostly we want the structure, not the text.
