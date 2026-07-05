# Candidate 01 — *The Complete Guide to Building Skills for Claude* (Anthropic PDF)

A 32-page Anthropic guide (Jan 2026): Fundamentals → Planning → Testing → Distribution → Patterns/Troubleshooting. **Core thesis:** a skill is "a set of instructions — packaged as a simple folder — that teaches Claude how to handle specific tasks or workflows," powered by **progressive disclosure** (frontmatter → SKILL.md body → linked files) so expertise loads only when relevant. Everything else is scaffolding around making "WHAT + WHEN" reliable and keeping token cost low.

## Transferable moves

1. **Three-level progressive disclosure** as the load-bearing principle. Frontmatter (always loaded) → body (on relevance) → linked files (on demand). Frame every layout decision in these terms. *"...provides just enough information for Claude to know when each skill should be used without loading all of it into context."*

2. **Frontmatter is the most important part.** *"The YAML frontmatter is how Claude decides whether to load your skill. Get this right."* Description formula: **`[What it does] + [When to use it] + [Key capabilities]`**, ≤1024 chars, MUST include both *what* and *when*. Name kebab-case; no `<>` (injection guard).

3. **Canonical layout.** `SKILL.md` (exact case) + optional `scripts/`, `references/`, `assets/`. No `README.md` inside the skill folder.

4. **Iterate on a single task before expanding.** Get one hard case working end-to-end, *then* extract and broaden. Faster signal than wide-shallow testing.

5. **Three test layers:** Triggering / Functional / Performance-vs-baseline. Triggering uses explicit "should trigger / should NOT trigger" lists. Performance compares same prompt with vs. without the skill (tokens, tool calls, retries).

6. **Diagnose triggering by asking Claude to quote it back.** *"Ask Claude: 'When would you use the [skill name] skill?' Claude will quote the description back. Adjust based on what's missing."*

7. **Under- vs over-triggering have opposite fixes.** Under → add detail/keywords. Over → add negative triggers ("Do NOT use for...") and narrow scope. Distinct failure modes.

8. **Five named workflow patterns:** sequential orchestration, multi-MCP coordination with phase separation, iterative refinement with quality gates, context-aware tool selection with decision trees, domain-specific intelligence (compliance-style gating). Useful taxonomy.

9. **Prefer scripts over prose for deterministic validation.** *"Code is deterministic; language interpretation isn't."* Bundle a script for critical checkable rules.

10. **Be specific and actionable.** Contrast "Make sure to validate things properly" vs. "CRITICAL: Before calling create_project, verify name non-empty, ≥1 member, start date not in past."

11. **Size budgets:** SKILL.md under **5,000 words**; recommend selective enablement above **20–50 skills**.

12. **Problem-first vs tool-first framing.** Does the skill orchestrate outcomes, or teach optimal use of a connected tool? Naming the axis sharpens design.

13. **"Skills are living documents."** Build the feedback → tweak → test loop into lifecycle from day one.

14. **Composability:** *"Your skill should work well alongside others, not assume it's the only capability available."*

## Memorable verbatim phrases worth keeping in our voice

- "What Claude can do" (MCP) vs. "How Claude should do it" (skill) — clean one-liner of the split.
- "MCP provides the professional kitchen... Skills provide the recipes."
- "Skills are living documents."
- "Iterate on a single task before expanding."
- "Code is deterministic; language interpretation isn't."
- "Put critical instructions at the top. Use ## Important or ## Critical headers. Repeat key points if needed."
- "Don't include README.md inside your skill folder."

## Bloat / contradictions to flag

- **Heavy MCP partner-marketing** throughout Ch 1/4/5 (positioning, outcomes-not-features). Skip for personal library.
- **Quantitative success criteria** ("triggers on 90%", "0 failed calls") are admitted vibes: *"there will be an element of vibes-based assessment."* Don't over-formalize.
- **"Model laziness — add encouragement"** tip is immediately undercut by *"Adding this to user prompts is more effective than in SKILL.md."* Don't import.
- **The recommended SKILL.md template** (Examples / Troubleshooting / Error handling boilerplate) is not followed by anthropics/skills' own skills. Starter, not rule.
- **Reserved-name rules** (`claude`/`anthropic` prefixes) — only relevant for public publishing.
