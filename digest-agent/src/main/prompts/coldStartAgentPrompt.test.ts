import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildColdStartAgentPrompt } from './coldStartAgentPrompt.ts';

const PROMPT_PATH = join(process.cwd(), 'prompts', 'cold-start-agent.md');
const BANNER = [
  '<!--',
  '  GENERATED FILE — do not edit.',
  '  Source: src/main/prompts/coldStartAgentPrompt.ts',
  '  Regenerate with: npm run regen:prompts',
  '-->',
  '',
].join('\n');

describe('cold-start agent prompt generator', () => {
  it('builds a non-empty prompt', () => {
    const prompt = buildColdStartAgentPrompt();
    expect(prompt.length).toBeGreaterThan(1000);
  });

  it('is idempotent: calling the builder twice returns identical output', () => {
    const a = buildColdStartAgentPrompt();
    const b = buildColdStartAgentPrompt();
    expect(a).toBe(b);
  });

  it('on-disk prompts/cold-start-agent.md is in sync with the source builder', () => {
    const expected = `${BANNER}${buildColdStartAgentPrompt()}`;
    const actual = readFileSync(PROMPT_PATH, 'utf-8');
    if (actual !== expected) {
      throw new Error(
        `prompts/cold-start-agent.md is out of sync. Run \`npm run regen:prompts\`.`,
      );
    }
  });

  it('directs the agent to use the typed write tools + run_sql for reads', () => {
    const prompt = buildColdStartAgentPrompt();
    // Reads via run_sql; schema reference via the playbook.
    expect(prompt).toContain('run_sql');
    expect(prompt).toContain('substrate-schema');
    expect(prompt).toContain('read_profile');
    // The typed write tools the cold-start agent must use.
    for (const tool of [
      'create_anchor',
      'update_anchor_layer',
      'create_entity',
      'create_relationship',
      'update_relationship_layer',
      'create_prediction',
      'set_reminder',
      'create_play',
    ]) {
      expect(prompt, `prompt should mention ${tool}`).toContain(tool);
    }
  });

  it('does NOT mention the retired aggregate read tools', () => {
    const prompt = buildColdStartAgentPrompt();
    for (const dead of [
      'list_anchors',
      'read_principal_anchor',
      'list_entities',
      'read_diary',
      'list_plays',
      'seed_principal_anchor',
    ]) {
      expect(prompt).not.toContain(dead);
    }
  });

  it('directs the agent to derive plays from observed activity', () => {
    const prompt = buildColdStartAgentPrompt();
    expect(prompt.toLowerCase()).toContain('play');
    expect(prompt).toContain('derived_from');
    expect(prompt).toContain('create_play');
  });

  it('mentions the persona-* MCP tools by name (test mode shims)', () => {
    const prompt = buildColdStartAgentPrompt();
    // email
    expect(prompt).toContain('list_emails');
    expect(prompt).toContain('get_email');
    expect(prompt).toContain('get_thread');
    expect(prompt).toContain('search_emails');
    // calendar
    expect(prompt).toContain('list_events');
    expect(prompt).toContain('list_operations');
    expect(prompt).toContain('get_event');
    expect(prompt).toContain('search_events');
    // notes
    expect(prompt).toContain('list_notes');
    expect(prompt).toContain('get_note');
    expect(prompt).toContain('get_note_at');
    expect(prompt).toContain('search_notes');
  });

  it('does NOT mention the retired persona-history tool names', () => {
    const prompt = buildColdStartAgentPrompt();
    for (const dead of ['recent_emails', 'recent_calendar', 'recent_notes', 'search_history']) {
      expect(prompt).not.toContain(dead);
    }
  });

  it("specifies _principal as the anchor id for the principal seed", () => {
    const prompt = buildColdStartAgentPrompt();
    expect(prompt).toContain('_principal');
  });
});
