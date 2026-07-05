/**
 * persona-email MCP server — test-mode stand-in for a real Gmail MCP.
 *
 * Spawned as a subprocess when an agent (cold-start, diary, or mind) needs
 * to read the principal's email history or recent inbox. Reads from
 * persona.db's `emails` table read-only.
 *
 * Tool surface (see `tools.ts`): `list_emails`, `get_email`, `get_thread`,
 * `search_emails`. Rich enough to serve both live ("recent inbound") and
 * historical ("emails between two dates") queries — there's no separate
 * history server.
 */

import { fileURLToPath } from 'node:url';
import {
  createPersonaSubServer,
  runPersonaSubServerCli,
  asPersonaTools,
  type PersonaSubServer,
  type PersonaSubServerOptions,
} from '../_personaServer/buildServer.js';
import { personaEmailTools } from './tools.js';

const SERVER_NAME = 'digest-persona-email';
const TOOLS = asPersonaTools(personaEmailTools);

export interface PersonaEmailServerOptions
  extends Omit<PersonaSubServerOptions, 'serverName' | 'tools'> {}

export function createPersonaEmailServer(opts: PersonaEmailServerOptions): PersonaSubServer {
  return createPersonaSubServer({ serverName: SERVER_NAME, tools: TOOLS, ...opts });
}

// CLI entry — used when this module is spawned as a Claude Code MCP subprocess.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runPersonaSubServerCli(process.argv.slice(2), {
    serverName: SERVER_NAME,
    usage:
      'usage: persona-email-server --persona-db=<path> [--digest-db=<path>] [--invocation-id=<id>] [--clock-anchor=<iso>]',
    tools: TOOLS,
  }).catch((err: unknown) => {
    console.error('[persona-email-server] fatal:', err);
    process.exit(1);
  });
}
