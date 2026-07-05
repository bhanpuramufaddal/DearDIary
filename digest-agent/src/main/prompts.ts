/**
 * Agent prompt loader — reads from the `prompts` DB table.
 *
 * Prompts are seeded from disk at boot by seedPrompts() (db/seedPrompts.ts)
 * and stored in the `prompts` table. This module is the single runtime access
 * point: no filesystem reads happen here.
 *
 * Composition: every system prompt is disposition + role-specific joined by
 * a `---` separator. disposition is the universal preamble; the role prompt
 * adds the agent's specific mandate and tools.
 */

import type { Db } from './db/index.js';

export type AgentRole = 'mind' | 'diary' | 'cold-start' | 'execution';

const ROLE_NAME: Record<AgentRole, string> = {
  mind: 'mind-agent',
  diary: 'diary-agent',
  'cold-start': 'cold-start-agent',
  execution: 'execution-agent',
};

/** DB name for the cold-start validator (second onboarding pass) prompt. */
export const COLD_START_VALIDATOR_NAME = 'cold-start-validator-agent';

function readPrompt(name: string, db: Db): string {
  const row = db.prepare('SELECT content FROM prompts WHERE name = ?').get(name) as
    | { content: string }
    | undefined;
  if (!row) throw new Error(`prompt not found in DB: "${name}" — run seedPrompts() at boot`);
  return row.content;
}

/** Compose the system prompt for a given role: disposition + per-role. */
export function loadSystemPrompt(role: AgentRole, db: Db): string {
  return composeSystemPrompt(ROLE_NAME[role], db);
}

/**
 * Compose disposition + an arbitrary prompt by DB name.
 * Use for prompts outside the typed AgentRole set (e.g. cold-start-validator).
 */
export function composeSystemPrompt(name: string, db: Db): string {
  const disposition = readPrompt('disposition', db);
  const rolePrompt = readPrompt(name, db);
  return `${disposition}\n\n---\n\n${rolePrompt}`;
}
