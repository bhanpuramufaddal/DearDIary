# 05 — ClawHub: Prompt Engineering Expert

**Source:** https://clawhub.ai/tomstools11/prompt-engineering-expert
**Result:** **No usable content fetched.** The ClawHub page is a marketplace listing only — metadata, capabilities tags, and use-case bullets. The actual SKILL body, system prompt, references, and scripts are *not* exposed on the public page.

## What we could see (metadata only)

- Name: "Prompt Engineering Expert"
- Owner: TomsTools (`tomstools11`)
- Category: Prompts
- Description (verbatim): *"Advanced expert in prompt engineering, custom instructions design, and prompt optimization for AI agents"*
- Version: v1.0.0 — License: MIT-0 — Downloads: 17.7k — Updated: ~2 weeks ago — Security: Pass
- Capability tags (8): prompt writing best practices, custom instructions design, prompt optimization, advanced techniques, evaluation & testing, anti-patterns recognition, context management, multimodal prompting
- Use-case bullets (7): refining prompts, creating specialized system prompts, designing agent instructions, optimizing for consistency, teaching best practices, debugging performance, creating templates

## Thesis

The listing positions itself as a meta-tool for *authoring and tuning prompts* — distinct from a skill that ships domain knowledge. If we ever obtained the body, the moves worth lifting would likely be: an anti-patterns checklist, an evaluation/regression rubric, and a "context management" section. None of that is accessible from the public page.

## Moves worth keeping

None recoverable from the public marketplace page. Three signals worth noting only as **directional inspiration** for our own prompt-engineering skill, not as content to lift:

1. **Frame the skill as both authoring and debugging.** The capability split between "writing best practices" and "anti-patterns recognition" implies two distinct modes — one for green-field prompt authoring, one for triage on an existing underperforming prompt. Our own version should probably have both entry points.
2. **Treat "evaluation & testing" as a first-class section.** Most prompt skills omit this. A built-in rubric (consistency, regression cases, eval harness) is a differentiator.
3. **Multimodal as a separate concern.** Worth a dedicated subsection rather than scattered tips — image/audio prompting has its own anti-patterns.

## Recommendation

**Skip.** The MIT-0 license would let us lift content if we had it, but we don't. The ClawHub listing alone is not enough signal to design around — too vague, no concrete craft visible. If we want a prompt-engineering skill, build from Anthropic's published prompting guide and our own observed failure modes; do not block on ClawHub access.

## Open questions (would unblock this candidate)

- Does ClawHub offer a download/preview that reveals SKILL.md to authenticated users? If TomsTools publishes the source elsewhere (GitHub, gist), that's where to look — the marketplace listing is a dead end.
