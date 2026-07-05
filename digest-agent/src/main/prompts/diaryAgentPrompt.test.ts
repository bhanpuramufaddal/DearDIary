import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDiaryAgentPrompt } from './diaryAgentPrompt.ts';

const PROMPT_PATH = join(process.cwd(), 'prompts', 'diary-agent.md');
const BANNER = [
  '<!--',
  '  GENERATED FILE — do not edit.',
  '  Source: src/main/prompts/diaryAgentPrompt.ts',
  '  Regenerate with: npm run regen:prompts',
  '-->',
  '',
].join('\n');

describe('diary agent prompt generator', () => {
  it('builds a non-empty prompt', () => {
    const prompt = buildDiaryAgentPrompt();
    expect(prompt.length).toBeGreaterThan(1000);
  });

  it('is idempotent: calling the builder twice returns identical output', () => {
    const a = buildDiaryAgentPrompt();
    const b = buildDiaryAgentPrompt();
    expect(a).toBe(b);
  });

  it('on-disk prompts/diary-agent.md is in sync with the source builder', () => {
    const expected = `${BANNER}${buildDiaryAgentPrompt()}`;
    const actual = readFileSync(PROMPT_PATH, 'utf-8');
    if (actual !== expected) {
      throw new Error(
        `prompts/diary-agent.md is out of sync. Run \`npm run regen:prompts\`.`,
      );
    }
  });

  it('mentions every per-template MCP tool name', () => {
    const prompt = buildDiaryAgentPrompt();
    for (const name of [
      'write_email_draft_inline',
      'write_calendar_block_decision',
      'write_choose_one_cards',
      'write_free_text_reply_compose',
      'write_diary_prose_note',
      'write_diary_prose_flash',
      'write_big_number_metric',
      'write_stat_block_summary',
      'write_chart_timeseries',
      'write_chart_bar',
      'write_report_brief',
    ]) {
      expect(prompt).toContain(name);
    }
    expect(prompt).not.toContain('write_email_draft_contextual');
    expect(prompt).not.toContain('write_doc_tile_read');
  });

  it('mentions clear_diary and delete_diary_component', () => {
    const prompt = buildDiaryAgentPrompt();
    expect(prompt).toContain('clear_diary');
    expect(prompt).toContain('delete_diary_component');
  });
});
