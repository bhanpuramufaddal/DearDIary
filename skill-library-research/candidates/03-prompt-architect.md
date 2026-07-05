# 03 — Prompt Architect (ckelsoe/claude-skill-prompt-architect)

**What it is.** An Agent-Skills-compatible prompt engineering skill (MIT, npm-installable) that rewrites vague prompts into structured ones using **27 research-backed frameworks** organized into **7 intent categories** (RECOVER, CLARIFY, CREATE, TRANSFORM, REASON, CRITIQUE, AGENTIC). Core thesis: *"Apply a framework when there's a gap between what the user asked for and what they need. If there's no gap, there's no job for a framework."* It scores prompts across 5 dimensions, asks 3–5 clarifying questions, recommends a framework with reasoning, then emits a clean copy-ready prompt plus an analysis note. The task brief referenced "7 frameworks" — the repo actually carries 27; the 7 is the *intent-category* count.

## Moves worth keeping

1. **Intent-category routing (RECOVER / CLARIFY / CREATE / TRANSFORM / REASON / CRITIQUE / AGENTIC).** Pick the *job-to-be-done* first, framework second. Avoids the trap of memorizing acronyms before knowing what you're optimizing for. Use this as the top-level branch in our prompt-writing skill.
2. **Decision tree as primary interface.** A linear cascade of yes/no questions ("transforming existing content? → BAB. agentic? → ReAct. content with audience/tone? → CO-STAR..."). Beats a lookup table for fresh users. Vendor the tree wholesale; trim frameworks we don't ship.
3. **Three-section delivery format: Analysis / Usage / Revised prompt.** Output never bleeds framework headers into the final prompt — the copy-ready block is clean. Important separation we should preserve.
4. **Quality scoring across 5 axes (clarity / specificity / context / completeness / structure, 1–10).** Lightweight pre/post comparison gives the user evidence the rewrite worked. The scoring is hand-waved (no rubric) but the *frame* is useful.
5. **Progressive disclosure: 3–5 questions max per turn.** Same constraint Prompt Master uses — converges to "ask the smallest number of questions that unblock the framework."
6. **Reference files loaded on demand.** Each framework lives in `references/frameworks/<name>.md` (600+ lines each, with worked examples + research citations). SKILL.md stays small (~5 KB); deep reference is lazy-loaded. Strong pattern for our library.
7. **Templates as separate artifacts.** Each framework also has a `.txt` template in `assets/templates/`. Splits "explain the framework" from "give me the fill-in-the-blank skeleton." Worth replicating.
8. **Research citations on advanced frameworks** (Self-Refine NeurIPS 2023, Step-Back DeepMind ICLR 2024, PS+ ACL 2023, CAI Anthropic 2022, FATA arXiv 2025, etc.). Cheap credibility signal.

## The 7 originally requested frameworks (verbatim acronym expansion)

| Framework | Acronym | When to use | Verdict |
|---|---|---|---|
| **CO-STAR** | Context, Objective, Style, Tone, Audience, Response | Content/writing where tone + audience drive quality. | **Keep verbatim.** Best-in-class for writing tasks. |
| **RISEN** | Role, Instructions, Steps, End goal, Narrowing | Multi-step procedures where the *Narrowing* (what NOT to do) matters. | **Keep verbatim.** The Narrowing slot is the unique value. |
| **RISE** | Role, Input/Instructions, Steps, Expectation/Examples (two variants: IE and IX) | Data transforms (IE) or example-driven creation (IX). | **Adapt.** Useful pattern but the IE/IX split feels like over-taxonomy — collapse to one with optional Examples slot. |
| **TIDD-EC** | Task, Instructions, Do, Don't, Examples, Context | High-precision tasks needing explicit guardrails (compliance, code-with-standards). | **Keep verbatim.** Explicit Do/Don't slots are rare and load-bearing. |
| **RTF** | Role, Task, Format | Simple, well-defined tasks where expertise framing drives output. | **Keep verbatim.** Minimum viable structured prompt. |
| **CoT** (Chain of Thought) | "Let's think step by step" — explicit intermediate reasoning steps | Complex reasoning / problem-solving where one path suffices. | **Keep verbatim** but flag: don't use on reasoning-native models (Prompt Master rightly calls this out). |
| **CoD** (Chain of Density) | Iterative refinement that progressively increases information density | Summarization, compression, explanation optimization. | **Keep verbatim.** Underused; worth promoting. |

(Bonus tier worth vendoring from the 27: **BAB**, **APE**, **Tree of Thought**, **ReAct**, **Self-Refine**, **Pre-Mortem**, **Devil's Advocate**, **RPEF**, **Reverse Role Prompting**, **Step-Back**, **Plan-and-Solve**. These add genuine coverage CO-STAR/RISEN don't have.)

## LICENSE verdict

**MIT, copyright 2025 prompt-architect contributors.** Vendor-OK. We can copy framework reference files and templates verbatim provided we keep the MIT notice and attribution in the file or a top-level NOTICE/LICENSE. Cleanest move: copy the `references/frameworks/` directory wholesale into our skill, prepend an "Adapted from ckelsoe/prompt-architect under MIT" line at top of each, and ship our own LICENSE-third-party.md.

## Anti-patterns / bloat to drop

- **27 frameworks is too many for a single skill.** Decision fatigue. Prompt Master's stripped 12-template set is more honest. Vendor ~10–12.
- **Two Python scripts (`framework_analyzer.py`, `prompt_evaluator.py`).** Skill executes fine without them — they're hand-wavy. Skip.
- **`adapters/` directory + npm package + plugin marketplace + Windsurf adapter.** Distribution scaffolding irrelevant to a personal library. Strip.
- **CHANGELOG.md, MIGRATION.md, package.json, .github/workflows.** Distribution-only files. Skip.
- **Quality scoring is unanchored** — scores feel made up (no per-criterion rubric, no examples of a 4 vs a 7). Either build a real rubric or drop the scores and just describe the gap qualitatively.
- **CRISPE's "Experiment = N variants"** conflates a framework with a delivery option. Better expressed as a meta-instruction layered on any framework.
- **Hybrid template** in `assets/templates/hybrid_template.txt` — vague combinator, no clear semantics. Skip until a real use case demands it.
