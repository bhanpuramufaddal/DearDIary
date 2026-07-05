# Candidate 02 — `anthropics/skills` repository (17 shipped skills)

17 skills Anthropic ships themselves, plus a minimal `template/`, a `spec/` pointer (now at agentskills.io), and a `.claude-plugin/` for marketplace install. **Implicit thesis** from reading side-by-side: SKILL.md is a *workflow document, not a reference manual* — every skill keeps SKILL.md tight and pushes depth into `references/`, `scripts/`, `agents/`, `examples/`, or `assets/`. The description is the load-bearing surface; bodies vary in tone but share a skeleton.

## Frontmatter shape (observed across all 17 skills)

```yaml
---
name: skill-name-in-kebab-case          # required, matches folder name
description: <single string OR quoted>  # required; what + when, often very long
license: Complete terms in LICENSE.txt  # optional, present in ~14/17
---
```

That's the whole schema in practice. **No skill uses `metadata:`, `allowed-tools:`, or `compatibility:`** despite the guide listing them — strong signal they're truly optional. `skill-creator` and `doc-coauthoring` omit `license` entirely. License is the only field with meaningful variation.

### Description style — two camps

**Short and crisp** (~30–60 words): algorithmic-art, brand-guidelines, canvas-design, frontend-design, mcp-builder, webapp-testing, slack-gif-creator, theme-factory, internal-comms, skill-creator.

**Long, exhaustive trigger lists** (quoted strings, 150–250 words) with TRIGGER/SKIP clauses and negative-trigger lists: xlsx, pptx, docx, pdf, claude-api. Skill-creator explicitly endorses this: *"make the skill descriptions a little bit 'pushy'"* to combat under-triggering. Long descriptions are deliberate pushiness, not bloat.

## Directory patterns (what shows up across skills)

| Subdir | Convention | Where seen |
|---|---|---|
| `references/` (or `reference/`) | Reference docs Claude reads on demand; one file per domain/variant; named `<topic>.md` | skill-creator, mcp-builder |
| `scripts/` | Executable utilities called as black-boxes; **never read into context** | mcp-builder, webapp-testing, skill-creator |
| `examples/` | Concrete worked examples or domain-specific guideline files Claude *loads* and follows | webapp-testing, internal-comms |
| `assets/` | Templates, fonts, icons embedded in *output* | skill-creator, algorithmic-art (`templates/`) |
| `agents/` | Prompt files for subagents the skill spawns (`grader.md`, `analyzer.md`, `comparator.md`) | skill-creator only |
| Language dirs (`python/`, `typescript/`, `go/`, ...) | Per-language reference bundles, parallel structure | claude-api |
| `LICENSE.txt` at root | Present in 15/17 skills | most |

**webapp-testing's black-box-script idiom, worth lifting verbatim:** *"Always run scripts with `--help` first... DO NOT read the source until you try running the script first and find that a customized solution is absolutely necessary... They exist to be called directly as black-box scripts rather than ingested into your context window."*

**Naming:** snake_case for `.py` scripts; kebab-case for skill folders; reference `.md` files mix both — low signal.

## Strongest moves (showing up repeatedly across skills)

1. **SKILL.md is a router; depth lives in sibling files.** internal-comms and mcp-builder are pure examples: SKILL.md says "identify the type, load `examples/<type>.md`, follow it." Dominant architecture.

2. **Imperative voice, theory-of-mind over MUSTs.** Skill-creator: *"explain to the model why things are important in lieu of heavy-handed musty MUSTs."* frontend-design and claude-api still use ALL-CAPS for genuinely critical rules — selectively.

3. **First section is a decision/branch, not the happy path.** webapp-testing opens with an ASCII decision tree; claude-api opens with a "Before You Start" provider-detection gate that aborts; internal-comms opens with a router. Pattern is everywhere.

4. **Sub-500-line SKILL.md ceiling.** Skill-creator: *"Keep SKILL.md under 500 lines; if you're approaching this limit, add an additional layer of hierarchy along with clear pointers about where the model using the skill should go next."* Skill-creator itself is 485 lines.

5. **"Pushy" descriptions to combat under-triggering.** Lift as a rule, not a suggestion.

6. **Black-box scripts with `--help` as the only contract** (webapp-testing). Protects context window vs. embedding script bodies as references.

7. **Hard pre-flight gates at the top.** claude-api scans for non-Anthropic markers and aborts; frontend-design forces commitment to a direction *before* code. **First instruction is a stop/branch.**

8. **Examples-as-loadable-files, not inline.** internal-comms keeps zero examples in SKILL.md and 4 files in `examples/`.

9. **Domain-by-variant organization.** *"When a skill supports multiple domains/frameworks, organize by variant"* — `references/{aws,gcp,azure}.md`. claude-api scales this with per-language dirs.

10. **Subagent prompts as first-class files** (skill-creator's `agents/grader.md`, `analyzer.md`, `comparator.md`). If a skill delegates, give each role its own prompt file.

11. **Casual tone is allowed.** Skill-creator: *"Cool? Cool."* and *"the rest of the skill :)"*. Clarity > formality.

## Bloat / things to skip

- **`template/SKILL.md`** is intentionally trivial (frontmatter + 1 line). Use as a literal seed, not a model.
- **`spec/agent-skills-spec.md`** is a redirect to agentskills.io. Dead weight in-repo.
- **docx/pptx/xlsx/pdf bodies** are source-available with a disclaimer that implementations differ from production. Frontmatter style is fine to copy; bodies are untrustworthy for replication.
- **`metadata:` / `allowed-tools:` / `compatibility:` fields** from the PDF guide are unused by all 17 skills. Skip unless concretely needed.
- **claude-api's multi-language parallel directories** are overkill for personal-library scope.
