#!/usr/bin/env -S uv run python
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "anthropic>=0.40.0",
#   "python-dotenv>=1.0",
# ]
# ///
"""
Meta-prompting harness.

We do NOT write the Person Generator's stage prompts by hand. This script asks
Claude Opus 4.7 to write each stage's system prompt and user prompt template,
given the full approved plan and a per-stage spec.

Run:
  uv run python scripts/generate_stage_prompts.py             # generate all (skips existing)
  uv run python scripts/generate_stage_prompts.py --force     # regenerate all
  uv run python scripts/generate_stage_prompts.py --only stage_00_spec
  uv run python scripts/generate_stage_prompts.py --list      # list stage IDs
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent  # /Users/mufaddal/Projects/myrico
DESIGN_DIR = ROOT / "design"  # canonical design docs: 00-overview.md … 10-storage.md
PROMPTS_DIR = ROOT / "src" / "persona_generator" / "prompts"
LOG_PATH = ROOT / "scripts" / "meta_prompting.log.jsonl"


def load_design_context() -> str:
    """Concatenate every persona-generator/design/*.md file in sorted order.

    The meta-prompt template's `{plan}` placeholder is replaced by this
    concatenation. Each design file is preceded by an HR + filename header so the
    LLM can navigate the bundle.
    """
    paths = sorted(DESIGN_DIR.glob("*.md"))
    if not paths:
        raise FileNotFoundError(f"no design docs found under {DESIGN_DIR}")
    chunks: list[str] = []
    for p in paths:
        chunks.append(f"\n\n---\n\n# {p.name}\n\n{p.read_text(encoding='utf-8').rstrip()}\n")
    return "".join(chunks).strip()

# .env lives at the repo root, not inside this subproject.
load_dotenv(REPO_ROOT / ".env")
client = Anthropic()
MODEL = "claude-opus-4-7"


# ---------------------------------------------------------------------------
# Stage specs
# ---------------------------------------------------------------------------

STAGES: list[dict] = [
    {
        "id": "stage_00_spec",
        "title": "Stage 0 — Spec Seed",
        "purpose": (
            "Take a free-form user prompt describing a persona and produce the "
            "seed artifacts that anchor everything downstream."
        ),
        "inputs": [
            "A free-form prompt string from the user describing the persona "
            "(e.g., 'Avery Chen, 37, CEO of Tessera, 12-person seed-stage B2B SaaS, "
            "Oakland, partner Sam and 4yo Wren, terse-direct, Pacific time')",
        ],
        "outputs": [
            "personas/<slug>.yaml — thin YAML with slug (derived from identity "
            "signals in the prompt), name, prompt_text (verbatim), created_at, "
            "seed (hash of prompt). NO personality fields, NO Big Five, NO schema-piling.",
            "internal/persona_origin.md — A reasoning trace introducing this persona. "
            "3–6 paragraphs of prose. Where they are in life right now. What anchors them. "
            "The biographical anchor everything downstream hangs from. Specific people, "
            "places, situations from the prompt named as subjects of sentences.",
        ],
        "notes": (
            "The slug must be derivable deterministically from identity signals in the prompt. "
            "The persona_origin.md must read like the opening pages of a profile in The New Yorker — "
            "specific, observational, alive — not like a bio sheet."
        ),
    },
    {
        "id": "stage_01a_life_context",
        "title": "Stage 1a — Life Context",
        "purpose": (
            "Produce a rich multi-section life narrative covering 6 domains as prose. "
            "This is the situational backdrop that everything downstream draws on."
        ),
        "inputs": [
            "personas/<slug>.yaml (for name, prompt_text, slug)",
            "internal/persona_origin.md",
        ],
        "outputs": [
            "internal/life_context.md — multi-section prose narrative with six sections "
            "(Professional, Family, Health, Relationships, Finances, Identity & Purpose). "
            "Each section is paragraphs describing current state, what's been happening over "
            "recent months, what's looming. Cross-domain tensions woven into the prose naturally "
            "(e.g., raise stress eats family time) — NOT in a separate intersections section.",
        ],
        "notes": (
            "No active_major_events arrays. No bulleted lists of concerns or recent_changes. "
            "Each domain is paragraphs. Specific people, dates, and stakes named in sentences. "
            "The document should read like a thoughtful biographer's draft, not a CRM form."
        ),
    },
    {
        "id": "stage_01b_character_sketch",
        "title": "Stage 1b — Character Sketch (back-stage truth)",
        "purpose": (
            "Produce the back-stage truth about who this persona really is — the omniscient "
            "narrator view that goes deeper than the persona's own self-awareness."
        ),
        "inputs": [
            "personas/<slug>.yaml",
            "internal/persona_origin.md",
            "internal/life_context.md",
        ],
        "outputs": [
            "internal/character_sketch.md — biographical sketch as prose. Covers personality "
            "(Big Five concepts surface in prose where load-bearing, never as a structured prelude), "
            "blind spots, failure modes, recurring patterns, identity roles, real relationship "
            "dynamics, energy patterns, what they conceal. The novelist's bible for the persona. "
            "Substantial — multiple sections of prose totaling 2,000–4,000 words.",
        ],
        "notes": (
            "Absolutely no Big Five prelude with scores. Absolutely no bias inventory as a bulleted list. "
            "Traits and biases surface inside sentences that describe behavior. The document should read "
            "as a thoughtful biographer's deep portrait, including blind spots, contradictions, "
            "and unspoken truths."
        ),
    },
    {
        "id": "stage_01c_judgment",
        "title": "Stage 1c — Judgment Reasoning (the essay)",
        "purpose": (
            "Write an essay titled 'How [persona] decides what matters this month' — "
            "the operational truth of their attention as narrative."
        ),
        "inputs": [
            "personas/<slug>.yaml",
            "internal/persona_origin.md",
            "internal/life_context.md",
            "internal/character_sketch.md",
        ],
        "outputs": [
            "internal/judgment.md — an essay. Sections walk through what fires the persona up, "
            "what they suppress, how context (active storylines, energy state, role activation) "
            "flips these defaults. Worked examples grounded in their specific life and character. "
            "Behavioral biases mentioned by name in prose where they apply (loss aversion under raise, "
            "present bias when tired, in-group warmth toward specific named people, etc.) — never "
            "as a bulleted inventory. Sections cover: what they tend to surface; what they suppress; "
            "what they'd be embarrassed to miss; how urgency works for them; how draft tone varies "
            "by audience; how their judgment shifts under stress.",
        ],
        "notes": (
            "Title the essay 'How <Name> decides what matters this month' and write it as an essay, "
            "not a dashboard. Specific examples grounded in named people and current situations from "
            "upstream documents."
        ),
    },
    {
        "id": "stage_01d_profile",
        "title": "Stage 1d — profile.md (front-stage compression, DERIVED)",
        "purpose": (
            "Produce the front-stage profile.md — the lossy compression that the digest agent reads. "
            "This is what the persona would write themselves if asked to write a profile for an AI assistant."
        ),
        "inputs": [
            "personas/<slug>.yaml",
            "internal/persona_origin.md",
            "internal/life_context.md",
            "internal/character_sketch.md (back-stage truth)",
            "internal/judgment.md (operational truth)",
            "Avery Chen's sample profile.md from the assignment brief (shape template: section structure, length, voice)",
        ],
        "outputs": [
            "profile.md — front-stage compression. Same shape as Avery's sample profile. Written in the "
            "persona's own voice (first person). Rule-shaped statements ('I batch reply', 'No newsletters'), "
            "NOT conditional functions. Aspirational, slightly self-flattering, sometimes wrong. The gap "
            "between this and the underlying judgment.md/character_sketch.md is intentional and structural — "
            "this is the DRIFT.",
        ],
        "notes": (
            "Tell the LLM explicitly: write what THIS PERSONA WOULD WRITE, not what is most accurate. "
            "Embrace lossiness. This is the only Stage-1 file the digest agent reads."
        ),
    },
    {
        "id": "stage_02_cast",
        "title": "Stage 2 — Cast",
        "purpose": (
            "Produce the cast of named people in this persona's life. P0–P1 get full prose profiles; "
            "lesser tiers get briefer treatment."
        ),
        "inputs": [
            "internal/persona_origin.md",
            "internal/life_context.md",
            "internal/character_sketch.md",
            "internal/judgment.md",
        ],
        "outputs": [
            "internal/cast.md — a document where P0–P1 cast members each get a multi-paragraph profile "
            "written as prose. Each profile covers: who this person is in their own right, how they came "
            "to be in the persona's life, what they're working toward, what makes them go quiet, how they "
            "speak. P2 gets one paragraph. P3–P4 listed by name + role only. NO bulleted current_goals lists, "
            "NO communication_quirks lists — sentences.",
            "Rows in persona.db.cast table (via add_cast_member): {cast_id, display_name, signal_tier, role_brief}. "
            "ONLY for code cross-reference. No interiority fields.",
        ],
        "notes": (
            "A reader should finish a P0 profile feeling they understand someone, not having scanned a roster. "
            "The signal_tier is mentioned in prose where appropriate, not as a primary identity field."
        ),
    },
    {
        "id": "stage_03_archetypes",
        "title": "Stage 3 — Day Archetypes",
        "purpose": "Produce prose descriptions of 5–7 typical day shapes this persona experiences.",
        "inputs": [
            "internal/persona_origin.md",
            "internal/life_context.md",
            "internal/character_sketch.md",
            "internal/judgment.md",
            "internal/cast.md",
        ],
        "outputs": [
            "internal/day_archetypes.md — prose descriptions of 5–7 archetypes (e.g., normal, crisis, "
            "deep_work, family_heavy, big_meeting, recovery, weekend). Each archetype described in narrative "
            "('On a normal day, <Name>...') with a rough schedule embedded inside the prose. Persona-specific.",
        ],
        "notes": (
            "Each archetype gets a section with a title and 1–2 paragraphs of prose. Schedule details "
            "appear in prose ('she's in the office by 7:45...'), not in a table or bulleted list."
        ),
    },
    {
        "id": "stage_04_channels",
        "title": "Stage 4 — Channels",
        "purpose": "Describe how this persona uses each communication/work channel.",
        "inputs": [
            "internal/persona_origin.md",
            "internal/life_context.md",
            "internal/character_sketch.md",
            "internal/cast.md",
        ],
        "outputs": [
            "internal/channels.md — inventory of channels and how the persona uses each. Which carries which "
            "kinds of conversation. Which tools matter for their work. Family/personal channels. Written as prose.",
        ],
        "notes": (
            "Channels relevant to the persona's role and life. Mentioned in prose, e.g., 'Email is where the "
            "deal work happens — Marcus, Ben, Diane all live in her inbox. Slack carries internal team conversation; "
            "she's terse there.'"
        ),
    },
    {
        "id": "stage_05_storylines",
        "title": "Stage 5 — Storylines (narrative arcs, 35-day window)",
        "purpose": (
            "Produce 5–10 multi-day storylines that will play out over the 35-day window. The richness "
            "of a month of activity — phased arcs, mid-window resolution, mid-window emergence — is the "
            "substantive shift, not just a number bump from a shorter window."
        ),
        "inputs": [
            "internal/persona_origin.md",
            "internal/life_context.md",
            "internal/character_sketch.md",
            "internal/judgment.md",
            "internal/cast.md",
            "internal/channels.md",
            "Window dates: 2026-04-19 through 2026-05-23 (35 days). Days 1–5 = warm-up; Days 6–35 = eval window.",
        ],
        "outputs": [
            "internal/storylines.md — one section per storyline, written as a narrative arc. Where the story "
            "sits at window-start. What's been happening over the months leading up. What's at stake. Which "
            "cast members are entangled and HOW (specific postures, roles, dynamics) — mentioned in sentences "
            "explaining their dynamics, NOT in a 'characters:' list. What's likely to surface in the 35-day "
            "window and why. Which channels carry the story (mentioned in prose). Where the storyline "
            "temporarily inverts the persona's stated suppression rules, the inversion is explained in narrative — "
            "how it works for this persona at this moment — not as 'activates_overrides:' tags.",
            "Rows in persona.db: storylines (via add_storyline), declared_moments (via declare_digest_moment), "
            "noise_events + noise_effects (via declare_noise_event), planned_artifacts (via declare_planned_artifact). "
            "These structured rows are the authoritative authoring output that downstream stages consume; "
            "the markdown arc.md per storyline is the narrative-prose companion.",
        ],
        "notes": (
            "Arcs must be BORING REAL-WORLD WORK ARCS, not personal-drama arcs. The intent of this stage is "
            "to seed the kind of activity a working professional actually generates in a month — projects, "
            "contracts, hires, vendor evaluations, partnerships, audits, releases, customer calls. NOT "
            "secret-line-of-credit / hidden-therapy / family-decline subplot stacks. A persona has work, "
            "a family, a body, and a small number of relationships — the arcs are mostly work, plus one "
            "or two ordinary family/personal threads (a kid's school event, a doctor's appointment that "
            "keeps getting moved, a parent's visit, a friend's wedding). That's it.\n\n"
            "Good arc shapes (for a startup CEO persona, by example):\n"
            "  • Series A raise with two real VC firms (use real names — Sequoia, KP, Founders Fund, "
            "    Index, Benchmark — verify via WebSearch); arc phases outreach → diligence → IC → "
            "    term sheet → close.\n"
            "  • Annual contract renewal with a specific named real customer (Stripe ops team, Notion "
            "    revops team, Ramp, whoever is plausible); renewal date lands mid-window.\n"
            "  • Hiring loop for a specific named role (VP of Sales, Staff Engineer for the "
            "    Notifications service) with N candidates, one of whom signs.\n"
            "  • Integration / partnership conversation with a real company (Slack, Linear, HubSpot).\n"
            "  • Annual board meeting prep + the actual board meeting (real format, real deck sections).\n"
            "  • Q3 OKR planning cycle.\n"
            "  • SOC 2 Type 2 audit with a real auditor firm (A-LIGN, Schellman, Prescient).\n"
            "  • Kid's school spring concert / parent-teacher conference / pediatrician appointment.\n"
            "  • Partner's work trip or a planned family vacation.\n\n"
            "Bad arc shapes (FORBIDDEN — these read as fiction subplot, not real-world activity):\n"
            "  • 'The slow grief of Sam' / 'Devon's unraveling' / 'Lillian's silence' — relationship "
            "    subtext as its own storyline.\n"
            "  • 'The body and what she has decided not to hear' — health-as-metaphor.\n"
            "  • 'Carolyn's Substack went silent' — fictional Substacks, fictional friends with "
            "    fictional newsletter brands.\n"
            "  • Any storyline whose title is a sentence-fragment in the literary register.\n\n"
            "Density expectations for a 35-day window:\n"
            "  • 5–10 storylines per persona. Multiple parallel arcs, not one monolithic raise.\n"
            "  • The raise (or equivalent big work initiative) should PHASE — outreach → diligence → "
            "    IC → term sheet → close — across 2–3 phases in 35 days.\n"
            "  • Some storylines RESOLVE within the window (hire signs Day 9, contract closes Day 17, "
            "    audit completes Day 22).\n"
            "  • Some storylines EMERGE mid-window (new prospect Day 14, vendor inbound Day 22).\n"
            "  • Short micro-arcs (5–10 days) coexist with long arcs spanning the full window.\n"
            "  • Periodic events become storyline beats — board meeting cadence, weekly all-hands, "
            "    biweekly 1:1s.\n\n"
            "Each storyline section is a title plus 4–8 paragraphs of plain, mundane prose. Cast "
            "members and counterparty companies are named as subjects of sentences. Expected beats "
            "are discussed in prose, not enumerated. The WebSearch tool MUST be used to verify all "
            "real-world entity names (VC firms, customers, vendors, conferences, auditors)."
        ),
    },
    {
        "id": "stage_06_window_plan",
        "title": "Stage 6 — Window Plan",
        "purpose": (
            "Outline the 35-day window — which days are which archetypes, which storyline beats land where (loosely), "
            "which arcs resolve and roughly when."
        ),
        "inputs": [
            "internal/persona_origin.md",
            "internal/life_context.md",
            "internal/character_sketch.md",
            "internal/judgment.md",
            "internal/cast.md",
            "internal/day_archetypes.md",
            "internal/storylines.md",
            "Window dates: 2026-04-19 through 2026-05-23 (35 days). Days 1–5 = warm-up. Days 6–35 = eval window. "
            "Day 33 (2026-05-21) is the brief's sample digest day.",
        ],
        "outputs": [
            "internal/window_plan.md — narrative outline of the 35 days. Walks through the window roughly week-by-week "
            "(5 weeks: warm-up week + 4 eval weeks) in prose. Which days are likely which archetypes. Storyline beats "
            "land where they naturally land. Which arcs are expected to resolve and roughly when. The warm-up/eval-window "
            "boundary at Day 6 is mentioned but not over-emphasized.",
            "Rows in persona.db.initial_calendar_events (via add_initial_calendar_event): event_id, title, "
            "start_iso, end_iso, attendees_json, recurring_rrule, calendar_id. Recurring events + pre-scheduled "
            "meetings that exist at Day 1, 00:00 PT, including any board meetings / off-sites / anniversaries that "
            "fall within the 35-day window. This is the seed state the calendar service emulator replays against.",
        ],
        "notes": (
            "The window_plan.md is loose — it's a plan, not a script. Stage 7 will deviate. "
            "The initial_calendar_events rows are the only structured output this stage produces."
        ),
    },
    {
        "id": "stage_07_living_day",
        "title": "Stage 7 — Living the Day (the noise stage; one call per day, 35 days)",
        "purpose": (
            "For a single day N, generate the day's lived experience: what happened, what state propagated, "
            "what artifacts were planted, what calendar ops happened. Called 35 times sequentially "
            "(Days 1–5 warm-up + Days 6–35 eval window)."
        ),
        "inputs": [
            "(prompt-cached upstream foundation): persona_origin, life_context, character_sketch, judgment, "
            "cast.md, channels, day_archetypes, storylines arc.md files, window_plan",
            "Today's pre-declared events from persona.db: planned_artifacts WHERE target_render_date = N "
            "and noise_events WHERE occurrence_date = N",
            "internal/daily_state/day_(N-1).md (the accumulated state from the prior day, or empty for Day 1)",
            "Cumulative rows from persona.db.calendar_ops (for context on calendar churn so far)",
            "Current date and day number N",
        ],
        "outputs": [
            "Day-N section appended to activity_log.md — what happened today, written as a journal entry. "
            "Names people and events in sentences. NOT an 'events:' list.",
            "internal/daily_state/day_NN.md — narrative state document for end of Day N. Each open thread "
            "discussed in its own paragraph by name. Active storylines surface in prose where they're felt "
            "today. Energy, mood, what's about to be dropped — all integrated into narrative.",
            "Rows INSERTed into persona.db: emails (via emit_email) and notes (via write_note) for each "
            "pre-declared artifact rendered today. The artifact_id, kind, sender/recipient, and date were "
            "fixed at Stage 5; this stage supplies the body in persona voice and the right tonal zone.",
            "Rows INSERTed into persona.db.calendar_ops (via add_calendar_op): "
            "{ts_iso, op, event_id, source: 'direct'|'email', linked_message_id, payload_json}. Some calendar "
            "moves are intentionally NOT op-logged (creating organic email↔calendar contradictions); when this "
            "happens, the daily_state narrative explains why.",
        ],
        "notes": (
            "The output needs a structured envelope (XML-tagged sections or similar) so the orchestrator knows "
            "what was produced — but each section's body is prose where the plan says so. The prompt should make "
            "the prose-first principle very explicit, since this stage has the most artifacts and the most "
            "temptation to slip into list-style output."
        ),
    },
    {
        "id": "stage_08_artifact_emission",
        "title": "Stage 8 — Artifact Emission (LLM path; one call per artifact)",
        "purpose": (
            "For a single artifact (email/note/task), generate the actual prose text in the persona's voice, "
            "based on the planted_artifact_trace from Stage 7."
        ),
        "inputs": [
            "internal/planted_artifact_traces/<artifact_id>.md (the reasoning paragraph for this artifact)",
            "internal/daily_state/day_NN.md (the day's state)",
            "internal/character_sketch.md (for voice)",
            "internal/cast.md (for the named recipient/sender)",
            "Artifact type (email | note | task) and tonal_zone (extracted from the trace's conclusion)",
        ],
        "outputs": [
            "For email: complete RFC 822 .eml content with proper headers (From, To, Subject, Date, Message-ID, "
            "In-Reply-To if threaded). Body in the persona's voice in the appropriate tonal zone. Include hidden "
            "X-Synth-* extract headers (X-Synth-Storyline, X-Synth-Tonal-Zone, X-Synth-Decoy, X-Synth-Source-Trace) "
            "carrying extracts from the planted_artifact_trace.",
            "For markdown note: a complete .md file in the persona's voice (usually private back-stage or "
            "internal mid-stage). YAML frontmatter at top with X-Synth-* fields for eval.",
        ],
        "notes": (
            "The voice must match the tonal_zone identified by the planted_artifact_trace. The X-Synth-* "
            "headers are extracts from the trace, not new judgment."
        ),
    },
    {
        "id": "stage_09a_validation",
        "title": "Stage 9a — Digest Validation (one agent per active declared moment; parallel-per-moment)",
        "purpose": (
            "For one declared digest moment whose final lifecycle (after applying all noise effects with "
            "effective_from ≤ target_morning) is DECLARED and whose target_morning ∈ Days 6–35: check whether "
            "the moment is still internally consistent given the persona's now-known past. Spawned once per "
            "active moment (~80–150 invocations per persona)."
        ),
        "inputs": [
            "The moment's final state (target morning M, section, priority, action_class, rationale, "
            "supporting_artifact_ids) — passed in by the orchestrator after lifecycle resolution.",
            "The persona's complete past as of morning M, via the service emulator's REST/MCP "
            "(or direct DB queries scoped by date): emails / notes with date_iso ≤ end-of-day-(M-1), the "
            "calendar state at that timestamp, every supporting artifact's full content.",
            "internal/daily_state/day_(M-1).md — yesterday's accumulated state",
            "internal/character_sketch.md, internal/judgment.md — persona's voice and judgment (reference only)",
        ],
        "outputs": [
            "Exactly one of: validation_pass / validation_fail / validation_correct — each INSERTs a row into "
            "persona.db.validation_log keyed by moment_id.",
        ],
        "notes": (
            "The agent answers ONE narrow question: 'given this past, is this declared moment still internally "
            "consistent?' Checks: coherence (rationale aligns with supporting artifacts), currency (action not "
            "already taken), cross-item consistency (no contradiction with other active moments at the same "
            "morning), persona fit (would this persona care about this on this morning, per their judgment essay), "
            "cascade integrity (after all lifecycle effects, does the final state make sense). The validator does "
            "NOT re-author or improve moments beyond minor corrections. Failure modes are narrow and verifiable: "
            "obsolescence, contradiction, rationale-references-events-that-didn't-happen."
        ),
    },
    # Stage 9b (Assembly) is deterministic SQL — no agent prompt; see design/08-validation-and-assembly.md.
]


# ---------------------------------------------------------------------------
# Stage tools registry — agent runtime is the default execution mode.
# Every stage in this registry is an agent loop with the listed tools.
# Stages not in this dict are deterministic (no LLM) — currently none in STAGES.
# ---------------------------------------------------------------------------

# File tools available from claude-agent-sdk. Description is short — agents already know these.
FILE_TOOL_DESCRIPTIONS = {
    "Read": "Read(path, offset=0, limit=N) — read a file (paginated). Use for upstream docs.",
    "Write": "Write(path, content) — create or overwrite a file with the given content.",
    "Edit": "Edit(path, old_string, new_string) — find-and-replace in an existing file.",
    "Glob": "Glob(pattern) — list files matching a glob pattern.",
    "Grep": "Grep(pattern, path) — search file contents.",
}

STAGE_TOOLS: dict[str, dict] = {
    "stage_00_spec": {
        "file_tools": ["Write"],
        "structured_tools": [
            {
                "name": "write_persona_spec",
                "signature": "write_persona_spec(slug: str, name: str, prompt_text: str, created_at_iso: str, seed_hex: str)",
                "purpose": "Validates and writes personas/<slug>.yaml. slug must be lowercase snake_case derivable from identity signals in the prompt; seed_hex should be sha256(prompt_text)[:16].",
            },
        ],
        "expected_outputs": [
            "personas/<slug>.yaml — written via write_persona_spec tool",
            "internal/persona_origin.md — written via Write tool (3–6 paragraphs, magazine-feature voice)",
        ],
    },
    "stage_01a_life_context": {
        "file_tools": ["Read", "Write", "Edit"],
        "structured_tools": [],
        "expected_outputs": [
            "internal/life_context.md — multi-section life narrative (6 domains) written via Write/Edit. The agent may draft section by section.",
        ],
    },
    "stage_01b_character_sketch": {
        "file_tools": ["Read", "Write", "Edit"],
        "structured_tools": [],
        "expected_outputs": [
            "internal/character_sketch.md — 2–4K word biographical sketch written via Write/Edit.",
        ],
    },
    "stage_01c_judgment": {
        "file_tools": ["Read", "Write", "Edit"],
        "structured_tools": [],
        "expected_outputs": [
            "internal/judgment.md — essay 'How <Name> decides what matters this month' written via Write/Edit.",
        ],
    },
    "stage_01d_profile": {
        "file_tools": ["Read", "Write"],
        "structured_tools": [],
        "expected_outputs": [
            "profile.md — front-stage compression, ~1 page, in persona's first-person voice. Written via Write.",
        ],
    },
    "stage_02_cast": {
        "file_tools": ["Read", "Write", "Edit"],
        "structured_tools": [
            {
                "name": "add_cast_member",
                "signature": "add_cast_member(cast_id: str, display_name: str, signal_tier: 'P0'|'P1'|'P2'|'P3'|'P4', role_brief: str)",
                "purpose": "INSERTs a row into persona.db.cast: {cast_id, display_name, signal_tier, role_brief}. Call once per cast member whose name appears in cast.md.",
            },
        ],
        "expected_outputs": [
            "internal/cast.md — written via Write/Edit (P0–P1 get multi-paragraph profiles; P2 one paragraph each; P3–P4 name+role only).",
            "Rows in persona.db.cast — populated via add_cast_member calls.",
        ],
    },
    "stage_03_archetypes": {
        "file_tools": ["Read", "Write"],
        "structured_tools": [],
        "expected_outputs": [
            "internal/day_archetypes.md — written via Write (5–7 archetypes, prose per archetype with schedule embedded).",
        ],
    },
    "stage_04_channels": {
        "file_tools": ["Read", "Write"],
        "structured_tools": [],
        "expected_outputs": [
            "internal/channels.md — written via Write (prose inventory of channels and how the persona uses each).",
        ],
    },
    "stage_05_storylines": {
        "file_tools": ["Read", "Write", "Edit"],
        "structured_tools": [
            {
                "name": "add_storyline",
                "signature": "add_storyline(storyline_id: str, display_name: str, arc_path: str)",
                "purpose": "INSERTs a row into persona.db.storylines: {storyline_id, display_name, arc_path}. Call once per storyline before writing its arc.md.",
            },
            {
                "name": "declare_digest_moment",
                "signature": "declare_digest_moment(moment_id: str, storyline_id: str, target_morning: str, section: str, priority: 'P0'|'P1'|'P2', action_class: str, rationale: str, supporting_artifact_ids: list[str])",
                "purpose": "INSERTs a row into persona.db.declared_moments plus child rows in moment_supporting_artifacts. Call once per digest moment the storyline should produce on some morning M ∈ Days 6–35.",
            },
            {
                "name": "declare_noise_event",
                "signature": "declare_noise_event(noise_id: str, storyline_id: str, occurrence_date: str, triggers_artifact_id: str|None, effects: list[dict])",
                "purpose": "INSERTs a row into persona.db.noise_events plus child rows in noise_effects (one per effect: SHIFTED/CANCELED/MODIFIED/DECLARED with its own effective_from).",
            },
            {
                "name": "declare_planned_artifact",
                "signature": "declare_planned_artifact(artifact_id: str, storyline_id: str, target_render_date: str, kind: 'email'|'note'|'calendar_invite'|'calendar_update', content_sketch: str|None, is_decoy: bool = False)",
                "purpose": "INSERTs a row into persona.db.planned_artifacts. Every artifact that will exist on the persona's surfaces is declared here at Stage 5; Stage 7 renders the actual prose.",
            },
        ],
        "expected_outputs": [
            "internal/storylines/<storyline_id>/arc.md per storyline — written via Write (narrative arc prose only).",
            "Rows in persona.db.storylines, declared_moments, moment_supporting_artifacts, noise_events, noise_effects, planned_artifacts — populated via the four structured tools above.",
        ],
    },
    "stage_06_window_plan": {
        "file_tools": ["Read", "Write"],
        "structured_tools": [
            {
                "name": "add_initial_calendar_event",
                "signature": "add_initial_calendar_event(event_id: str, title: str, start_iso: str, end_iso: str, attendees_json: str, recurring_rrule: str|None, calendar_id: str = 'primary')",
                "purpose": "INSERTs a row into persona.db.initial_calendar_events. Use for recurring 1:1s, pre-scheduled board meetings, off-sites, anniversaries — events that exist on the calendar at Day 1, 00:00. The calendar service emulator replays calendar_ops against these seed rows.",
            },
        ],
        "expected_outputs": [
            "internal/window_plan.md — written via Write (5-week narrative outline; warm-up + 4 eval weeks).",
            "Rows in persona.db.initial_calendar_events — populated via add_initial_calendar_event calls (typically 5–15 seed events).",
        ],
    },
    "stage_07_living_day": {
        "file_tools": ["Read", "Write", "Edit", "Glob"],
        "structured_tools": [
            {
                "name": "add_calendar_op",
                "signature": "add_calendar_op(ts_iso: str, op: 'add_event'|'move_event'|'cancel_event'|'accept_invite'|'decline_invite'|'tentative_invite'|'update_event', event_id: str, source: 'direct'|'email', linked_message_id: str|None, payload_json: str)",
                "purpose": "INSERTs a row into persona.db.calendar_ops. The agent calls this for every calendar change today that should land on the calendar. Deliberately omit the call when the storyline calls for an email-driven move that the calendar never receives (the email-without-op contradiction case).",
            },
        ],
        "expected_outputs": [
            "Day-N section appended to activity_log.md (via Edit, with a '## Day {day_number} — {iso_date}' heading)",
            "internal/daily_state/day_{day_number_padded}.md — written via Write (narrative state at end of Day N)",
            "Rows in persona.db.emails / notes for today's pre-declared artifacts (via emit_email / write_note tools — see Stage 8 for details)",
            "Rows in persona.db.calendar_ops — appended via add_calendar_op calls (zero to many per day)",
        ],
    },
    "stage_08_artifact_emission": {
        "file_tools": ["Read", "Glob"],
        "structured_tools": [
            {
                "name": "emit_email",
                "signature": "emit_email(message_id: str, from_addr: str, to_addrs: list[str], cc_addrs: list[str], subject: str, date_iso: str, in_reply_to: str|None, body: str, x_synth_storyline: str|None, x_synth_moment_id: str|None, x_synth_tonal_zone: str, x_synth_decoy: bool, x_synth_source_plan: str)",
                "purpose": "INSERTs one row into the `emails` table in persona.db. Columns populated: message_id (PK), from_addr, to_addrs (JSON), cc_addrs (JSON), subject, date_iso, in_reply_to, body, x_synth_* fields. The mail service emulator renders this row as RFC 822 .eml on demand when the digest agent calls GET /messages/{id}. Body in persona's voice in the appropriate tonal zone.",
            },
            {
                "name": "write_note",
                "signature": "write_note(filename: str, title: str|None, body: str, created_iso: str, x_synth_storyline: str|None, x_synth_moment_id: str|None, x_synth_tonal_zone: str|None, x_synth_source_plan: str|None)",
                "purpose": "INSERTs one row into the `notes` table in persona.db. The notes service emulator renders the row as markdown on demand when the digest agent calls GET /notes/{id}. Body is persona-voice markdown.",
            },
        ],
        "expected_outputs": [
            "One row in emails table per planted email artifact (via emit_email)",
            "One row in notes table per planted note artifact (via write_note)",
        ],
    },
    "stage_09a_validation": {
        "file_tools": ["Read", "Glob"],
        "structured_tools": [
            {
                "name": "validation_pass",
                "signature": "validation_pass(moment_id: str, justification: str)",
                "purpose": "INSERTs a row into persona.db.validation_log with status='pass'. The moment is internally consistent given the persona's now-known past.",
            },
            {
                "name": "validation_fail",
                "signature": "validation_fail(moment_id: str, reason: str, severity: 'minor'|'major')",
                "purpose": "INSERTs a row with status='fail'. Stage 9b will exclude this item. Reason should describe a real coherence/currency/contradiction issue.",
            },
            {
                "name": "validation_correct",
                "signature": "validation_correct(moment_id: str, corrected_rationale: str, corrected_priority: str|None, justification: str)",
                "purpose": "INSERTs a row with status='correct'. Item stands with a minor correction; Stage 9b applies the corrected fields when emitting.",
            },
        ],
        "expected_outputs": [
            "One row in persona.db.validation_log per active declared moment validated (~80–150 per persona).",
        ],
    },
    "stage_09b_assembly": {
        # No LLM — single SQL query joining declared_moments ⋈ noise_effects ⋈ validation_log,
        # partitioned by morning, written to 30 ideal_digests/morning_NN.json files.
        # No agent prompt to generate; this entry exists for completeness in the registry only.
        "file_tools": [],
        "structured_tools": [],
        "expected_outputs": [
            "ideal_digests/morning_06..35.json — 30 files, each produced by the SQL assembly query (see design/08-validation-and-assembly.md).",
        ],
    },
}


# ---------------------------------------------------------------------------
# Meta-prompt: this is what we send TO Claude so Claude writes the stage prompts.
# This is the only prompt we hand-author. Every actual pipeline prompt is LLM-written.
# ---------------------------------------------------------------------------

META_SYSTEM_TEMPLATE = """You are a senior prompt engineer designing prompts for a multi-stage LLM pipeline called the Person Generator. The pipeline produces synthetic data for a "Daily Digest" personal triage tool.

Your job: write the AGENT SYSTEM PROMPT and USER PROMPT TEMPLATE for ONE specific stage of the pipeline. **The pipeline runs every stage as an agent loop** (using `claude-agent-sdk`). The agent has file tools and zero or more typed structured-output tools. Your job is to write the agent's instructions, not a single-completion prompt.

The full architectural plan is below for context.

# THE CORE PRINCIPLE — this is non-negotiable

The pipeline is REASONING-TRACE-FIRST. Each agent must produce rich prose reasoning in its output documents, NOT structured schema completion. There are two failure modes the prompts you write must structurally avoid asking for:

**Failure mode 1 — schema completion in prose documents.** Prompts that ask the agent to fill JSON/YAML fields with values inside a markdown document. Outputs become tag-completion: `personality.neuroticism = 0.58`, `current_goals: [...]`. This produces lifeless data. (Schema is fine when it goes through the typed structured tools — those validate. It is not fine when the agent writes raw structured blocks into a `.md` file.)

**Failure mode 2 — entity-list-as-derivation (subtler, easier to fall into).** Prompts that ask for narrative but the narrative degenerates into bulleted entity references: `characters: [marcus, ben]`, `activates_overrides: [no_newsletters]`, `biases_invoked: [...]`. This LOOKS like reasoning but is still mechanical — it lists what's connected without explaining how or why.

The prompts you write must structurally push the agent AWAY from both failure modes and TOWARD:

- Multi-paragraph prose with full sentences in markdown documents
- Named entities (people, storylines, traits, biases) mentioned as SUBJECTS OF SENTENCES inside the reasoning ("Marcus has been quiet since Tuesday — Avery has read his last message four times and still doesn't know whether to push") — NOT in lists
- Reasoning that considers alternatives and lands on conclusions
- Specific evidence (named people, dates, dynamics) integrated into prose
- Where the agent emits structured data (JSON, JSONL, YAML, .eml), it does so via the **typed structured tools** — not by writing raw JSON blocks. The tools validate the schema.

# REGISTER — this is non-negotiable

The pipeline produces *data about a real-feeling person living a boring real-world life*. NOT literary fiction. NOT a novel chapter. The voice is the voice of an interviewer's notes, a public-records search, or an HR file — flat, observational, mundane. If a sentence sounds like it could open a New Yorker profile, rewrite it. The boring real world is the goal: the persona pays a mortgage, drops a kid at school, has a 1:1 every Tuesday at 10, gets coffee from the place near the office, has a doctor's appointment they keep moving. The narrator records what happened, not how it felt.

The prompts you write must explicitly forbid the following novelistic registers, and require the plain-observed-fact register instead. State each anti-pattern STRUCTURALLY (the shape to avoid). When you give a bad example, invent a fresh hypothetical phrase that illustrates the shape — do not borrow language from any specific prior generation or sample document.

**Forbidden registers (the prompts must teach each one structurally, not by enumerating specific phrases):**

1. **Simile or metaphor that describes inner states through physical-object images.** Any construction where an emotion, decision, or memory is framed as a thing carried, weighed, pressing, receding, sharp, heavy, or otherwise corporeal. The narrator records the observable fact underneath, not the image.

2. **Narrator vantage beyond what is observable.** The narrator does not have access to what the persona has not articulated, has not admitted, has not allowed themselves to think. Any construction where the narrator asserts an unspoken inner state, or treats the absence of a decision as itself meaningful, or paraphrases what the persona "would say if she said it" — out of bounds. The narrator stays outside the persona's head and records only what was done, sent, scheduled, said aloud, or made visible to others.

   Sub-shapes of this same failure that the prompt must teach BY EXAMPLE (worked BAD/GOOD pair for each):
   - **Asserting a duration of interior knowledge** ("she has known this for nine years"). The narrator cannot watch someone *know* something for a length of time; they can only watch the behavior over the duration. Rewrite as the observable pattern across that span.
   - **Asserting a private decision** ("she has decided privately that she will raise it after the raise closes"). The narrator cannot see a decision that was never made aloud. Rewrite as what has and has not happened.
   - **Mind-reading another character** ("he has not raised it because he can see what week it is"). Even worse than mind-reading the persona — the secondary character's interior is further from any observable surface. Rewrite by stating what the character did and did not do; leave the inferred motive out.
   - **Meta-narrating the prompt's own instructions** (the prose announcing which thread is "the load-bearing thread" or which concern is "the one real concern"). The reader should infer load-bearingness from emphasis and return-rate in the prose, not be told. Rewrite by writing the thread plainly and leaving the labels off.

3. **Anaphora, parallelism, and cadence tricks.** No three or more consecutive sentences sharing an opening or closing construction for rhythmic effect. Paragraphs end on a fact, not on a beat.

4. **Symbolically loaded objects and set-piece scenes.** No invented locations, no invented languages or countries, no objects that exist to carry emotional weight, no memories arriving "loaded with meaning." A toy is a toy. A wedding is a wedding. If a detail matters, state it plainly without ceremony.

5. **Subplot stacking, current-life.** A real person has one or two ongoing concerns at a time, plus ordinary friction. Do not give a persona five or eight simultaneous hidden crises. If upstream documents already established a primary tension, that is the tension; do not add new ones unless the stage's specific purpose requires it.

6. **Subplot stacking, biographical.** The same bound applies to the persona's history. One or two formative biographical threads, total — not five. A childhood loss, a first failure that mattered, a specific moment that shaped how they read pressure: pick one or two and let the rest of the biography be ordinary (school, jobs, moves, marriage) without each ordinary fact carrying weight. If the persona's `persona_origin.md` or `life_context.md` already named a formative thread, deepen it rather than adding new ones. The character_sketch.md output is the place this fails most often: it accumulates a USAMO miss + a parent's hurtful comment + a foreign romance + a co-founder's quiet decline + a partner going silent on Sundays. That is five backstory crises stapled together. Pick one.

6. **Vague abstract decision-language.** No "priority matrix," "attention budget," "high-leverage signals," "gravity," "lensing." The concrete time, person, channel, or artifact always wins.

**Required register (the prompts must call for this explicitly):**

- **Plain declaratives.** "Her LDL is 158." "She runs about three times a week." "She rescheduled the cardiologist appointment twice." Facts you could put in a chart. The HR-file register, the doctor's-notes register, the LinkedIn-bio-but-honest register.
- **Specificity in dates, dollars, addresses, named real-world entities** — NOT in pithy psychological framings.
- **State each tension once, factually, without returning to it as a leitmotif.** If she's anxious about the raise, mention it where load-bearing — don't thread it through every paragraph.
- **The reader should not be moved.** The reader should feel they have read accurate notes about a plausible, ordinary, slightly-busy person.
- **Aim for the texture of a real diary entry** — "Tuesday morning: standup at 10, then 1:1 with Devon at 11:30 (we still need to talk about Q3 OKRs), pickup at 5:15." NOT "Tuesday morning: she stood at the kitchen island, the gravity of the raise pressing on her shoulders."

**Few-shot BAD/GOOD pairs are the PRIMARY teaching mechanism for these rules — not rule-text, not post-hoc verifier regex.** A prior version of this pipeline used regex over the generated prose to flag narrator-omniscience violations; the regex produced false negatives on subtle violations (it caught "she has not, in any settled way, told herself X" but missed "she has known this for years") and false positives on phrasing the prompts actively wanted. Regex over prose has been removed and is forbidden. The way to enforce these rules is to give the agent enough worked examples that it pattern-matches against the good shape.

**Each authoring stage prompt must include 3–6 BAD → GOOD rewrite pairs that show the shape of the fix.** Cover at minimum: the inner-state-as-physical-object shape, the narrator-asserts-interior-state shape, the duration-of-interior-knowledge shape, and the mind-reading-another-character shape. Invent fresh hypothetical phrasings for the BAD examples — do not borrow language from any specific prior generation or sample document. The goal is to show the shape (image-laden inner-state sentence → plain observable fact), not to enumerate blacklisted phrases.

A representative shape of the rewrite (illustrative — invent your own when authoring the stage prompt):

- A sentence framing an emotion as an object the persona is carrying or weighed down by → a sentence stating the underlying observable fact (an appointment they rescheduled, a meeting they skipped, a person they have not called).
- A sentence narrating something the persona has-not-admitted-to-themselves → a sentence stating only what is externally visible.
- A sentence ending on a beat tuned for cadence → a sentence ending on a fact.

# REAL-WORLD ENTITIES — this is non-negotiable

The synthetic data must be embedded in the real United States, not in invented brand-territory. The prompts must require:

**Every small detail must be real.** Down to the street name. Down to the ZIP code. Down to the highway exit. Down to the specific coffee shop on that block. The agent has WebSearch — it MUST use it to verify any named detail before committing it to prose.

**Required real-world anchors:**

- **Real US cities, towns, neighborhoods.** Oakland CA, Berkeley, Mountain View, Brooklyn, Washington DC, Bethesda — yes. Invented cities — no. Specific real neighborhoods are encouraged where load-bearing (Rockridge, Glen Park, Park Slope, Adams Morgan).
- **Real streets and addresses.** If the persona lives "in the lower Oakland hills off Broadway Terrace," Broadway Terrace must be a real street in Oakland (it is). If their preschool is "on College Avenue," College Avenue must be a real street there. If they grab coffee at Blue Bottle on Mint Plaza, Mint Plaza must exist and Blue Bottle must have (or have had) a location there. Use real street names, real intersections, real ZIP codes. The agent uses WebSearch to confirm.
- **Real companies the persona works at, sells to, or interacts with.** Google, Microsoft, Stripe, Salesforce, Atlassian, Andreessen Horowitz, Sequoia Capital, Goldman Sachs, Citadel, Two Sigma, Kirkland & Ellis, Latham & Watkins, etc. The persona's own employer should be a real, existing company; their customers and investors should be real, existing firms.
- **Real schools, hospitals, universities, with real addresses.** UCSF (505 Parnassus Ave, San Francisco), Stanford, Berkeley, Harvard Law, Head-Royce (4315 Lincoln Ave, Oakland), Bentley, Park Day School. No invented schools. If the persona has kids in preschool, name a real local one (e.g., "Aquatic Park School," "Bay Area Discovery Museum's preschool program") — the agent uses WebSearch to find a real one in the right neighborhood. Real cardiologists practice at real hospitals: Sutter Health, UCSF, Kaiser Permanente, Stanford Healthcare. No invented medical practices.
- **Real political parties and offices** (when load-bearing in passing — e.g. a persona mentions "the Democratic primary," or follows a real Senator on X). Democrats, Republicans, US Senate, House, real serving Senators or Representatives mentioned by name only if they actually serve in 2026. Do NOT use a persona whose JOB is political (Chief of Staff, lobbyist, legislative aide) — the entire domain is too prone to inventing fictional bills and fictional offices.
- **Real foods, restaurants, brands.** In-N-Out, Whole Foods, Trader Joe's, Sweetgreen, Equinox, Peloton. Real coffee shops where they live (Blue Bottle, Sightglass, Philz). No invented restaurant chains, no invented diet brands. If the persona orders Thai takeout from "that place on Piedmont Ave," that place must be a real Thai restaurant on Piedmont Ave that the agent can name (e.g., Champa Garden, Soi 4, Lucky Three Seven).
- **Real publications, podcasts, conferences.** Stratechery, Lenny's Newsletter, NYT, WSJ, The Atlantic, Stack Overflow, Hacker News, GitHub, Y Combinator, AWS re:Invent, SaaStr, RSA Conference. No invented Substacks (the persona's friends can have Substacks, but they're real Substacks the agent can name).
- **Real flights, airports, hotels, real travel logistics.** SFO to JFK on United at 7:25 AM, not "a 7 AM flight east." If the persona stays at "the Andaz in Wynwood," the Andaz Miami must exist (it does, in 5th & Alton, not Wynwood — the agent should check).
- **Real news events, real dates.** If the persona is reacting to "the Fed's rate decision yesterday," the agent looks up which day that was and whether a rate decision actually happened, given the in-world date.

**Forbidden:**

- Invented company names (Tessera, Veridian Capital, Northbrook, Loadgrid, Verand, Horizon Partners, Operating System Substack). If the persona is a founder, the company can be FICTIONAL but its NAME and PRODUCT must be plausible-sounding and not collide with a famous real company. *However*, every external entity (customers, investors, vendors, competitors, schools, neighborhoods) must be REAL.
- Invented foreign countries, invented vacation destinations, invented home countries for cast members. Every place name resolves to a real place a reader could find on a map.
- Invented news outlets, podcasts, Substacks, software products, frameworks.
- Generic placeholders ("a Series A firm", "a logistics company") where a real name would do.

The exception: the persona's own employer-if-they're-a-founder may be a plausible fictional company name (e.g., a 12-person seed-stage startup needs a name; that name can be invented but should sound like a real startup, not be heavy-handed). Everyone else and everywhere else is real.

# AGENT RUNTIME — what's available to the agent at runtime

The agent runs with working directory `data/<slug>/` (scoped per persona). It has:

- **File tools** (from claude-agent-sdk): see the toolset listed in this stage's spec below. `Read` is paginated — the agent should call `Read(path, offset=N, limit=M)` to chunk through long upstream documents rather than loading them whole.
- **Web tools** (built into Claude Code): `WebSearch` for queries and `WebFetch` for retrieving a specific URL. These are available to every authoring stage and the prompts you write MUST encourage the agent to use them whenever a real-world entity (company, school, neighborhood, politician, news event, restaurant, conference, product) is being introduced. The agent should not rely on its training data to remember whether "Acme Coffee Roasters" is a real chain — it should look up, confirm, and use the real name (or pick a different real one).
- **Structured-output tools** (custom, validated): see the toolset listed in this stage's spec below. Each tool validates inputs via pydantic and writes/appends to the appropriate persona-scoped path. The agent calls these by name with typed arguments.
- **No** Bash, sub-agents, or arbitrary shell access.
- The agent runs in a ReAct-style loop: it reads → thinks → searches the web when grounding is needed → writes → repeats until it decides it's done. The orchestrator verifies the expected output files exist on termination.

**Using WebSearch / WebFetch — required for real-world grounding (see "REAL-WORLD ENTITIES" below):**

The prompts you write must instruct the agent to call `WebSearch` BEFORE committing to:

- The persona's employer (if a real company)
- The persona's customers, investors, competitors
- The cities, neighborhoods, schools, hospitals, universities mentioned
- Any politicians, government offices, election dates, legislation
- Any publications, podcasts, newsletters, conferences
- Any restaurants, chains, products, software the persona uses

The agent should NOT exhaust itself doing 50 WebSearches per stage; it should batch grounding into a small number of queries up front, then write. Typical: 6–15 WebSearches at the start of an authoring stage, then prose.

**Per-named-claim verification — required for any sentence that pairs a named person with a specific firm, role, or address.**

For the following classes of claim, the agent must run a `WebSearch` and then leave a hidden HTML comment immediately after the claim that cites what was found. The comment is invisible to the digest agent at runtime (it parses the markdown body) but is auditable by the eval harness and by anyone inspecting the file.

- **Person-at-firm** (e.g. "Sarah Bradley at Bessemer," "Cristina Cordova at Notion"). Search for the person and the firm. If the pairing is confirmed by a real page, cite it.
  - Format: `<!-- web-verified 2026-MM-DD: Bessemer team page lists Sarah Bradley as senior associate. -->`
  - If the pairing is NOT confirmed by a search, do not assert it. Either name a different real person who IS at that firm, or describe the person generically ("the associate running diligence at Bessemer").

- **School-with-street-number** (e.g. "Park Day School at 370 43rd Street"). Search for the school's address. If the search confirms the exact number, cite it. If only the street is confirmed, drop the number and write "on 43rd Street."
  - Format: `<!-- web-verified 2026-MM-DD: Park Day School address is 370 43rd Street, Oakland CA per parkdayschool.org. -->`

- **Local-business-at-address** (e.g. "Blue Bottle on Mint Plaza," "Two Star Market on Park Boulevard"). Search for the business. If it exists at the named location, cite. If it exists but at a different address, either correct the address or name a different real business that fits the neighborhood.

- **Politician + role + party** (e.g. "Senator Klobuchar, D-MN"). Search to confirm they currently serve in that role. If they no longer do, name a different real serving politician.

The verifier counts hidden web-verified comments per stage. Expected floor: roughly one comment per named external entity introduced. A stage that ships zero comments AND introduces five named externals is over-claiming and gets retried with the under-citation noted.

# CONTEXT — the full approved plan

{plan}

# Output format

Your output must be a single markdown document with these exact three sections:

```
## System prompt

<The agent system prompt for this stage. This goes to the agent at runtime. It should:
  - Establish the agent's role (what kind of writer/judgment-maker they are)
  - State the working directory explicitly
  - List the file tools available, with the agent expected to use Read paginated for long upstream documents
  - List the structured-output tools available, with their signatures and what each is for
  - State the expected output files — what must exist on disk when the agent terminates
  - Embed voice/depth requirements, anti-patterns to avoid, and reasoning-first principle reminders
  - End with a clear termination signal — when should the agent stop calling tools?

Several paragraphs, with the toolset declared clearly. Concrete good/bad examples embedded where helpful.>

## User prompt template

<The per-call user message that kicks the agent off. Uses {{placeholder}} syntax for runtime variables the orchestrator substitutes (e.g., {{persona_slug}}, {{day_number}}, {{iso_date}}, {{prior_daily_state_md}} etc.). Generally short — the system prompt carries the heavy detail; the user message just provides per-call specifics.>

## Notes for the engineer

<2–6 bullet points or short paragraphs for the engineer running this stage: what runtime variables to inject, expected file outputs the orchestrator should verify, typical tool-call counts, anti-patterns the prompt is designed to prevent.>
```

Write the prompts with the same care a senior writer would use — precise, specific, free of LLM-buzzword bloat ("you are a helpful assistant..."), grounded in the reasoning-first principle. Concrete examples of good vs. bad output embedded in the system prompt where helpful.
"""

META_USER_TEMPLATE = """The stage you are writing prompts for:

**ID:** `{id}`
**Title:** {title}

**Purpose:** {purpose}

**Inputs this stage receives (from upstream stages, available on disk under data/<slug>/):**
{inputs}

**Outputs this stage must produce (verified by orchestrator after agent terminates):**
{expected_outputs}

**File tools available to the agent:**
{file_tools_block}

**Structured-output tools available to the agent (typed, schema-validated):**
{structured_tools_block}

**Additional notes:**
{extra_notes}

Write the agent system prompt, the per-call user message template, and engineer notes for this stage now. Follow the output format from your instructions exactly."""


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def format_list(items: list[str]) -> str:
    return "\n".join(f"  - {x}" for x in items)


def format_file_tools(tool_names: list[str]) -> str:
    if not tool_names:
        return "  (none)"
    lines = []
    for name in tool_names:
        desc = FILE_TOOL_DESCRIPTIONS.get(name, "")
        lines.append(f"  - **{name}** — {desc}")
    return "\n".join(lines)


def format_structured_tools(tools: list[dict]) -> str:
    if not tools:
        return "  (none — this stage emits only prose via file tools)"
    lines = []
    for t in tools:
        lines.append(f"  - **{t['name']}**")
        lines.append(f"      signature: `{t['signature']}`")
        lines.append(f"      purpose:   {t['purpose']}")
    return "\n".join(lines)


def generate_for_stage(stage: dict, plan: str) -> tuple[str, dict]:
    tools_entry = STAGE_TOOLS.get(stage["id"], {})
    file_tools = tools_entry.get("file_tools", [])
    structured_tools = tools_entry.get("structured_tools", [])
    expected_outputs = tools_entry.get("expected_outputs", stage.get("outputs", []))

    system_text = META_SYSTEM_TEMPLATE.format(plan=plan)
    user_text = META_USER_TEMPLATE.format(
        id=stage["id"],
        title=stage["title"],
        purpose=stage["purpose"],
        inputs=format_list(stage["inputs"]),
        expected_outputs=format_list(expected_outputs),
        file_tools_block=format_file_tools(file_tools),
        structured_tools_block=format_structured_tools(structured_tools),
        extra_notes=stage.get("notes", "(none)"),
    )

    resp = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        system=[
            # cache the plan + meta-system so per-stage calls reuse it
            {"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}},
        ],
        messages=[{"role": "user", "content": user_text}],
    )

    body = "".join(block.text for block in resp.content if block.type == "text")

    usage_dict = {
        "input_tokens": resp.usage.input_tokens,
        "output_tokens": resp.usage.output_tokens,
        "cache_creation_input_tokens": getattr(resp.usage, "cache_creation_input_tokens", 0),
        "cache_read_input_tokens": getattr(resp.usage, "cache_read_input_tokens", 0),
    }
    return body, usage_dict


def write_log(stage_id: str, usage: dict, out_path: Path):
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
        "stage": stage_id,
        "model": MODEL,
        "usage": usage,
        "out": str(out_path.relative_to(ROOT)),
    }
    with LOG_PATH.open("a") as f:
        f.write(json.dumps(entry) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="regenerate even if file exists")
    parser.add_argument("--only", help="run only this stage_id")
    parser.add_argument("--list", action="store_true", help="list all stage IDs and exit")
    args = parser.parse_args()

    if args.list:
        for s in STAGES:
            print(f"{s['id']:36}  {s['title']}")
        return

    if not os.getenv("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY not set (check .env)")
        sys.exit(1)

    if not DESIGN_DIR.exists():
        print(f"ERROR: design directory not found at {DESIGN_DIR}")
        sys.exit(1)

    plan = load_design_context()
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)

    stages_to_run = STAGES
    if args.only:
        stages_to_run = [s for s in STAGES if s["id"] == args.only]
        if not stages_to_run:
            print(f"ERROR: no stage matching --only={args.only}")
            sys.exit(1)

    print(f"Design source: {DESIGN_DIR} ({len(plan):,} chars across {len(sorted(DESIGN_DIR.glob('*.md')))} files)")
    print(f"Output dir: {PROMPTS_DIR}")
    print()

    total_in = total_out = total_cache_read = total_cache_create = 0

    for stage in stages_to_run:
        out_path = PROMPTS_DIR / f"{stage['id']}.md"
        if out_path.exists() and not args.force:
            print(f"SKIP   {stage['id']:36}  (exists; pass --force to regenerate)")
            continue

        print(f"WRITE  {stage['id']:36}  ...", end="", flush=True)
        try:
            body, usage = generate_for_stage(stage, plan)
        except Exception as e:
            print(f"\n  ERROR: {e}")
            continue

        out_path.write_text(body)
        write_log(stage["id"], usage, out_path)

        total_in += usage["input_tokens"]
        total_out += usage["output_tokens"]
        total_cache_read += usage["cache_read_input_tokens"]
        total_cache_create += usage["cache_creation_input_tokens"]

        print(
            f" done. tokens in/out/cache-read/cache-write: "
            f"{usage['input_tokens']}/{usage['output_tokens']}/"
            f"{usage['cache_read_input_tokens']}/{usage['cache_creation_input_tokens']}"
        )

    print()
    print(
        f"TOTAL  tokens in/out/cache-read/cache-write: "
        f"{total_in}/{total_out}/{total_cache_read}/{total_cache_create}"
    )
    print(f"Log: {LOG_PATH}")


if __name__ == "__main__":
    main()
