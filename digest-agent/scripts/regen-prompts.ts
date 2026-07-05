#!/usr/bin/env node
/**
 * regen-prompts.ts — emit prompts (system prompts + per-template playbook
 * entries) from their TS source modules.
 *
 * Outputs:
 *   - `prompts/diary-agent.md`         — diary agent orchestrator
 *   - `prompts/cold-start-agent.md`    — cold-start agent
 *   - `prompts/playbook/templates/<template-id>.md` — one per template in the registry
 *
 * The .md files are build artifacts. Edit the TS sources / template registry,
 * then run this script (or `npm run regen:prompts`).
 *
 * `--check` mode (used by CI / tests) exits non-zero if any on-disk file is
 * out of sync with its source.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiaryAgentPrompt, renderTemplateSection } from '../src/main/prompts/diaryAgentPrompt.ts';
import { buildColdStartAgentPrompt } from '../src/main/prompts/coldStartAgentPrompt.ts';
import { buildColdStartValidatorAgentPrompt } from '../src/main/prompts/coldStartValidatorAgentPrompt.ts';
import { TEMPLATES, type TemplateRegistryEntry } from '../src/shared/templates/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '..', 'prompts');
const PLAYBOOK_TEMPLATES_DIR = resolve(PROMPTS_DIR, 'playbook', 'templates');

interface PromptSpec {
  /** Path relative to `prompts/`. */
  filename: string;
  /** Source path (relative to repo root) cited in the banner. */
  source: string;
  build: () => string;
}

function banner(source: string): string {
  return [
    '<!--',
    '  GENERATED FILE — do not edit.',
    `  Source: ${source}`,
    '  Regenerate with: npm run regen:prompts',
    '-->',
    '',
  ].join('\n');
}

function generate(spec: PromptSpec): string {
  return `${banner(spec.source)}${spec.build()}`;
}

function templatePlaybookFilename(templateId: string): string {
  return `playbook/templates/${templateId}.md`;
}

function buildTemplatePlaybookSpecs(): PromptSpec[] {
  return (TEMPLATES as readonly TemplateRegistryEntry[]).map((entry) => ({
    filename: templatePlaybookFilename(entry.templateId),
    source: `src/shared/templates/${entry.templateId}.ts`,
    build: () => `${renderTemplateSection(entry)}\n`,
  }));
}

function specs(): readonly PromptSpec[] {
  return [
    {
      filename: 'diary-agent.md',
      source: 'src/main/prompts/diaryAgentPrompt.ts',
      build: buildDiaryAgentPrompt,
    },
    {
      filename: 'cold-start-agent.md',
      source: 'src/main/prompts/coldStartAgentPrompt.ts',
      build: buildColdStartAgentPrompt,
    },
    {
      filename: 'cold-start-validator-agent.md',
      source: 'src/main/prompts/coldStartValidatorAgentPrompt.ts',
      build: buildColdStartValidatorAgentPrompt,
    },
    ...buildTemplatePlaybookSpecs(),
  ];
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function main(): void {
  const check = process.argv.includes('--check');
  let driftCount = 0;
  let writeCount = 0;

  // Ensure the playbook templates dir exists before write attempts.
  mkdirSync(PLAYBOOK_TEMPLATES_DIR, { recursive: true });

  const allSpecs = specs();
  for (const spec of allSpecs) {
    const path = resolve(PROMPTS_DIR, spec.filename);
    const generated = generate(spec);
    const current = readOrNull(path);

    if (check) {
      if (current !== generated) {
        console.error(
          `${path} is out of sync with ${spec.source}. Run \`npm run regen:prompts\`.`,
        );
        driftCount++;
      }
      continue;
    }

    if (current === generated) continue;
    writeFileSync(path, generated, 'utf-8');
    console.log(`Regenerated ${spec.filename}.`);
    writeCount++;
  }

  if (check) {
    if (driftCount > 0) process.exit(1);
    console.log(`All ${allSpecs.length} prompt(s) in sync.`);
    return;
  }
  if (writeCount === 0) console.log('No prompts changed.');
  else console.log(`Regenerated ${writeCount} prompt file(s).`);
}

main();
