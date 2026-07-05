# 04 — Prompt Master (nidhinjs/prompt-master)

**What it is.** A minimal Claude skill (root: `README.md`, `SKILL.md`, `LICENSE`, `references/{patterns.md, templates.md}`) that writes prompts *for other AI tools* — Claude, ChatGPT, Gemini, o1/o3, Cursor, Midjourney, ComfyUI, ElevenLabs, Sora, Zapier, etc. Core thesis: "Zero tokens or credits wasted — works on first try, zero re-prompts." It positions itself as a **cross-tool prompt compiler**: detect target tool → extract 9 intent dimensions → ask ≤3 questions → apply target-appropriate framework silently → strip non-load-bearing words → deliver one copyable block. The taxonomy is leaner than Prompt Architect (12 templates vs. 27 frameworks) but the **tool-routing logic is unique** and the strongest move in the repo.

## Moves worth keeping

1. **Tool detection as the FIRST gate, before framework selection.** A prompt for o3 needs no CoT scaffolding; a prompt for Midjourney is a different artifact from a prompt for Claude Code. Inverts the usual "framework-first" flow. **Vendor this primacy** — bake it into our skill's top-level routing.
2. **9-dimension intent extraction.** Task, Target tool, Output format, Constraints, Input, Context, Audience, Success criteria, Examples. Tighter than Prompt Architect's 5-dimension scoring; closer to a checklist than a rubric. **Keep verbatim as a pre-flight checklist.**
3. **Hard rule: max 3 clarifying questions.** Stricter than Prompt Architect's 3–5. Forces real prioritization. **Adopt the 3-cap.**
4. **"No CoT on reasoning-native models" hard rule.** Stops users from layering Chain of Thought on o1/o3/DeepSeek-R1, which actively degrades output. This kind of *anti-technique* knowledge is rarer and more valuable than yet-another-framework. **Vendor verbatim** as part of an Anti-Patterns section.
5. **Banned-techniques list** (Mixture of Experts, Tree of Thought, Graph of Thought, Universal Self-Consistency, layered prompt chaining flagged as "high fabrication risk"). Whether or not we agree with every entry, the *move* of having a banned list alongside the recommended list is good hygiene. **Adapt** — keep the structure, audit the entries.
6. **Primacy / Middle / Recency zone structure** in SKILL.md. Identity + hard rules at top, execution logic in middle, verification at bottom. Maps to known LLM attention curve. **Adapt** — useful framing for our own SKILL.md authoring.
7. **35 credit-killing patterns** across 6 categories (Task/7, Context/6, Format/6, Scope/6, Reasoning/5, Agentic/5). Lives in `references/patterns.md` (lazy-loaded). Diagnostic-first framing — *"here's what's wrong"* before *"here's the fix"*. **Vendor** as a Common Mistakes reference, contingent on inspecting the actual list.
8. **Memory Block system.** Extracts decisions from prior turns and prepends them to new prompts to prevent contradictions. Mechanism unclear from the fetched content — likely a documented convention rather than runtime state. **Investigate before vendoring**; the *idea* is good but implementation may be hand-waved.
9. **Output contract: copyable prompt block + target/rationale + setup instructions (if needed).** Three-part envelope. Similar to Prompt Architect's three-section delivery but tighter. **Keep** — converge our delivery format around this.
10. **Universal Fingerprint fallback** — 4 diagnostic questions for tools without specific profiles. Graceful degradation pattern. **Keep**.

## The 12 templates (auto-selected from intent + tool)

RTF, CO-STAR, RISEN, CRISPE, Chain of Thought, Few-Shot, File-Scope, ReAct + Stop Conditions, Visual Descriptor, Reference Image Editing, ComfyUI, Prompt Decompiler.

**Verdict on the unique-to-Prompt-Master ones** (the overlap with Prompt Architect is already covered in 03):

- **Few-Shot** — table-stakes; **keep verbatim**.
- **File-Scope** (for coding agents like Cursor/Claude Code: scope to specific files, forbid edits outside) — **keep verbatim**. Genuinely useful and rare.
- **ReAct + Stop Conditions** — ReAct with explicit "stop when X" clause. **Keep** — the stop-condition addition is the load-bearing bit.
- **Visual Descriptor** (Midjourney / image-gen) — **keep**, important for image tools.
- **Reference Image Editing** — **keep**.
- **ComfyUI** — **skip** unless we're shipping a ComfyUI workflow; too niche.
- **Prompt Decompiler** — same idea as Prompt Architect's RPEF (reverse-engineer a prompt from an output). **Keep one or the other**, not both; prefer RPEF's name since it has research grounding.

## Tool-routing taxonomy worth vendoring

22 tool categories grouped roughly: text LLMs (Claude / GPT-5 / Gemini / Qwen / Ollama / Llama / Mistral / DeepSeek-R1 / MiniMax), reasoning models (o3/o4-mini), code agents (Claude Code, Antigravity, Cursor, Windsurf, Cline, Copilot), no-code builders (Bolt, v0, Lovable, Figma Make, Stitch), autonomous SWE (Devin, SWE-agent), research/orchestration (Perplexity, Manus), computer-use, image, ComfyUI, 3D (Meshy, Tripo, Rodin), video (Sora, Runway, Kling, LTX, Dream Machine), voice (ElevenLabs), workflow (Zapier, Make, n8n). **Vendor the categorization wholesale** — even if we don't ship per-tool routing rules, having the *map* prevents us from treating "AI tool" as monolithic.

## LICENSE verdict

**MIT, copyright 2026 Nidhin Joseph Nelson.** Vendor-OK. Same handling as Prompt Architect: copy verbatim with attribution line in each file and a NOTICE/LICENSE-third-party entry.

## Anti-patterns / bloat to drop / risk flags

- **Refused-to-render SKILL.md via WebFetch.** The fetcher declined to reproduce the file verbatim, citing instruction-injection concerns ("Primacy Zone", "Hard Rules", instructions designed to modify model behavior). The framing is theatrical — we should **strip the "PRIMACY ZONE / RECENCY ZONE / Hard Rules" terminology** when vendoring. It signals prompt-engineering-as-cargo-cult and trips downstream tooling. Keep the content, drop the dramatics.
- **"Works on first try. Zero re-prompts."** Unverifiable success claim. Don't echo this in our skill — it sets a false bar.
- **22 tool categories** for one skill is impressive but maintenance-heavy. Each tool's prompting conventions drift (GPT-5 → GPT-5.1, Gemini 2 → 3 Pro). Vendor the *taxonomy* but resist embedding tool-specific rules until we know they're stable.
- **"Memory Block system" claim** appears to be a documented convention, not a runtime mechanism — there's no apparent state store. Don't over-promise this in our version.
- **Tiny file footprint** (4 files) is a strength, but `references/templates.md` and `references/patterns.md` are presumably enormous monoliths. Prompt Architect's one-file-per-framework is the better split — we should follow Architect's layout, not Master's.
- **No worked before/after examples** visible in the fetched content (unlike Prompt Architect's CO-STAR transformation example). Examples drive adoption; ship them.
