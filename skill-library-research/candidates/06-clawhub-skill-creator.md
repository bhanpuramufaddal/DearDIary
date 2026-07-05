# 06 — ClawHub: Skill Creator (meta-skill)

**Source:** https://clawhub.ai/chindden/skill-creator
**License:** MIT-0 — lift freely.
**Result:** Usable content fetched. Unlike the TomsTools listing, this ClawHub page exposes the actual skill body (or a close paraphrase). What follows is the substance.

## What the skill is + thesis

A meta-skill for authoring new skills. Its thesis is **progressive disclosure**: skills should load in three tiers — (1) ~100-word metadata always present, (2) a SKILL.md body under ~5k words loaded on trigger, (3) bundled `scripts/`, `references/`, `assets/` loaded only when needed. The author treats *the context window as a public good* and tells you to only include what Claude can't derive itself. The other governing concept is **degree of freedom**: high-freedom prose for flexible domains, low-freedom scripts for fragile/deterministic ones. These two ideas alone are worth more than most full skills.

## Moves worth keeping

1. **"Context window is a public good." (verbatim).** Lift this as a north-star principle in our own meta-skill. Reframes terseness from a stylistic preference to an ethical constraint shared across skills.

2. **Three-tier progressive disclosure.** Codify this explicitly:
   - Tier 1 — frontmatter `description` (~100 words, always loaded). The trigger contract.
   - Tier 2 — SKILL.md body (<5k words, loaded on trigger). The workflow.
   - Tier 3 — `scripts/` + `references/` + `assets/` (loaded only when SKILL.md instructs). The knowledge base.

3. **Degree-of-freedom rubric.** High freedom → prose instructions. Low freedom → deterministic scripts. Force the author to pick per resource. This is the single best heuristic for deciding "should this be a script or a paragraph?"

4. **Six-step authoring process** (worth lifting wholesale):
   1. **Understand with concrete examples** — get user examples first; validate scope before structure.
   2. **Plan reusable contents** — identify scripts, references, assets across the examples *before* writing SKILL.md.
   3. **Initialize skill** — scaffolding command (`init_skill.py <name>`).
   4. **Edit the skill** — implement bundled resources, then write SKILL.md frontmatter + body in imperative voice.
   5. **Package** — validator + bundler (`package_skill.py`).
   6. **Iterate** — refine from real usage.

   Useful order: examples → resource plan → scaffold → bodies → validate → ship. Most authors invert steps 2 and 4 and end up rewriting; this order is the right one.

5. **Frontmatter minimalism.** Only `name` and `description`. The description must include both *what the skill does* and *specific usage triggers*. This is tighter than the alirezarezvani standard (which adds license/version/metadata block) and arguably more correct for an Anthropic-native skill.

6. **No auxiliary files.** Explicit rule: no `README.md`, no `CHANGELOG.md`, no top-level docs inside the skill folder. SKILL.md is the entry point. Lift this — it's the cleanest enforcement against folder-bloat.

7. **References organize by domain/variant, one level deep.** Don't nest `references/foo/bar/baz.md`. Flat or one level — keeps progressive disclosure cheap.

8. **Scripts ship only when justified.** Two triggers: (a) code that would otherwise be rewritten repeatedly, or (b) operations where deterministic reliability matters more than flexibility. Otherwise prefer prose.

9. **Skill anatomy diagram** (verbatim worth copying):
   ```
   skill-name/
   ├── SKILL.md (required)
   │   ├── YAML frontmatter (name, description)
   │   └── Markdown instructions
   └── Bundled Resources (optional)
       ├── scripts/      (executable code)
       ├── references/   (documentation)
       └── assets/       (templates, icons, fonts)
   ```

## Bloat / things to skip

- The `init_skill.py` / `package_skill.py` scripts themselves are gated behind ClawHub — we'd need our own. Lift the *idea* (scaffold + validate), not the specific tooling.
- The marketing language ("modular, self-contained packages that extend Claude's capabilities") is fine as a definition but doesn't belong in our skill — write our own one-liner.

## Verdict

**Strong lift candidate.** This is the cleanest articulation of the progressive-disclosure model I've seen. Adopt the six-step process and the three-tier loading model in our own meta-skill (`~/.claude/skills/write-a-skill/` or similar). License is MIT-0 — no attribution required, but credit `chindden/skill-creator` anyway.
