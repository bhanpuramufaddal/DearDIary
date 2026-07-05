# 07 — alirezarezvani/claude-skills (mega-pack)

**Source:** https://github.com/alirezarezvani/claude-skills
**License:** **MIT** (Copyright (c) 2025 Alireza Rezvani). Permissive — lift freely with attribution.

## Scope + quality range

338 skills across 16 domains (engineering core + POWERFUL, product, marketing, productivity, research, research-ops, project management, regulatory & QM, compliance OS, c-level advisory, business growth, business operations, commercial, finance, plus orchestration/agents/templates/standards). Multi-agent-tool compatible (Claude Code, Codex, Gemini CLI, Cursor, Aider, Windsurf, Hermes, Mistral Vibe, + others — the repo carries parallel `.claude-plugin/`, `.codex-plugin/`, `.gemini/`, `.hermes/`, `.vibe/` folders). Quality range is **bimodal**: a tight authoring standard at the top, then 338 skills of wildly varying depth. Some folders are pure `.zip` archives (e.g. `senior-architect.zip`, `aws-solution-architect.zip`) — not source, no inspection possible. The hand-authored flagships are good; the bulk is "comprehensive" in the way a 300-channel cable package is comprehensive.

## Cross-cutting structural moves (worth lifting)

1. **Top-level `SKILL-AUTHORING-STANDARD.md`** at the repo root. This is the single best move in the repo. One document enforces conventions across 338 skills. We should have an analogous `~/.claude/skills/AUTHORING.md`.

2. **Frontmatter schema with explicit metadata block** (verbatim from the standard):
   ```yaml
   ---
   name: skill-name
   description: "When to use this skill. Include trigger keywords and phrases users might say."
   license: MIT
   metadata:
     version: 1.0.0
     author: [Author Name]
     category: domain-name
     updated: YYYY-MM-DD
   ---
   ```
   Richer than the ClawHub minimum (`name` + `description` only). Worth lifting the `updated` field and `category` for library-wide search; skip `version` unless we actually version. Note the `description` rule: *"include trigger keywords and phrases users might say"* — this is the contract that decides whether the skill loads.

3. **Naming conventions table** (lift wholesale):
   - Skill folders: `kebab-case`
   - Python scripts: `snake_case.py`
   - Reference docs: `kebab-case.md`
   - Templates: `kebab-case-template.md` (suffix convention)

4. **Hard size cap: "SKILL.md ≤10KB — if it's longer, move content to references."** Enforceable. Lift verbatim.

5. **Separation principle (verbatim): "SKILL.md is the workflow. Reference docs are the knowledge base. Keep them separate."** This is the single clearest articulation of the two-layer model I've seen. Workflow = imperative steps in SKILL.md; knowledge = static docs in `references/`.

6. **Scripts standard:** stdlib-only (no pip), CLI-first, JSON output, embedded sample data, 0-100 scoring scale. The "zero pip" rule is aggressive but right for portability — anyone can run them without `pip install`. Lift the rule for our own scripts.

7. **Required SKILL.md body skeleton** (lift the section order, possibly trim):
   - Opening: *"You are an expert in [domain]. Your goal is [outcome]."*
   - Before Starting (context checklist)
   - How This Skill Works (≥2 modes)
   - [Core content]
   - **Proactive Triggers** — *"Surface these issues WITHOUT being asked when you notice them"* (this is rare and good)
   - Output Artifacts (request→deliverable table)
   - Communication (confidence tags 🟢/🟡/🔴)
   - Related Skills (with WHEN/NOT disambiguation)

   "Proactive Triggers" and "Related Skills with WHEN/NOT" are the two distinctive moves. The first turns a passive skill into one that volunteers issues; the second prevents skills from cannibalizing each other's triggers.

8. **Pre-submission quality checks** (lift as a `quality_gates.md`):
   - SKILL.md ≤10KB
   - Practitioner voice ("Do X" not "consider X")
   - ≥4-6 Proactive Triggers
   - ≥4-6 Output Artifacts with format specified
   - Bidirectional cross-references in Related Skills
   - Confidence tagging methodology stated
   - ≥2 entry-mode workflows

## Three spot-checked skills

1. **`engineering/write-a-skill/skills/write-a-skill/`** — meta-skill, derived from Matt Pocock's `write-a-skill` with MIT attribution. Has `SKILL.md` + `references/` (4 docs: `companion_tooling.md`, `description_design_patterns.md`, `progressive_disclosure_principles.md`, `quality_gates_for_skills.md`) + `scripts/` (3 validators: `skill_description_validator.py`, `skill_review_checklist_runner.py`, `skill_structure_validator.py`). **Verdict: lift the validator scripts pattern and the 4 reference doc titles wholesale — this is the cleanest meta-skill in the repo.**

2. **`engineering-team/playwright-pro/`** — plugin bundle (not a single skill). Contains 10 sub-skills as separate folders (`browserstack`, `coverage`, `fix`, `generate`, `init`, `migrate`, `pw`, `report`, `review`, `testrail`), plus `agents/`, `hooks/`, `integrations/`. **Verdict: useful as an example of plugin-as-bundle (skill cluster sharing hooks and agents), but heavyweight — only worth studying if we build a multi-skill plugin ourselves.**

3. **`engineering-team/self-improving-agent/`** — plugin with `skills/`, `agents/`, `hooks/`, `reference/`, `templates/`, plus a `CLAUDE.md`. Sub-skills: `extract`, `promote`, `remember`, `review`, `self-improving-agent`, `status`. **Verdict: structurally interesting (sub-skill verbs map to lifecycle stages), but probably overkill for our library — the auto-memory idea is good, but Claude Code already has memory; we don't need a skill that re-implements it.**

## Bloat / what to skip

- The `.zip` skills (`senior-architect.zip`, `tdd-guide.zip`, etc.) — opaque, can't inspect, ignore.
- 66 c-level-advisor skills, 46 marketing skills — domain-specific, unlikely relevant to our library; sample only if a specific need comes up.
- The multi-agent-tool fan-out (`.codex-plugin/`, `.gemini/`, `.hermes/`, `.vibe/`) — we only ship Claude Code, don't lift this complexity.
- Custom-GPT folder — irrelevant.

## License verdict

**MIT. Safe to lift.** Standard MIT terms, copyright Alireza Rezvani 2025. We should preserve a `metadata.derived_from` line in any skill we adapt (the repo itself does this for Matt Pocock derivations — clean precedent to follow).

## Net recommendation

Lift the **authoring standard**, the **naming conventions**, the **10KB cap**, the **Proactive Triggers + Related Skills WHEN/NOT** sections, and the **three validator scripts** from `write-a-skill`. Skip the 338 individual skills as a library — too noisy, too bimodal. The repo's value is its *standard*, not its catalog.
