/**
 * persona-notes MCP server — test-mode stand-in for a real Notes / Notion
 * MCP. Reads `notes` from persona.db.
 *
 * Tool surface (see `tools.ts`): `list_notes`, `get_note`, `get_note_at`,
 * `search_notes`. Rich enough to serve live and historical (point-in-time)
 * snapshot reads.
 */

import { fileURLToPath } from 'node:url';
import {
  createPersonaSubServer,
  runPersonaSubServerCli,
  asPersonaTools,
  type PersonaSubServer,
  type PersonaSubServerOptions,
} from '../_personaServer/buildServer.js';
import { personaNotesTools } from './tools.js';

const SERVER_NAME = 'digest-persona-notes';
const TOOLS = asPersonaTools(personaNotesTools);

export interface PersonaNotesServerOptions
  extends Omit<PersonaSubServerOptions, 'serverName' | 'tools'> {}

export function createPersonaNotesServer(
  opts: PersonaNotesServerOptions,
): PersonaSubServer {
  return createPersonaSubServer({ serverName: SERVER_NAME, tools: TOOLS, ...opts });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runPersonaSubServerCli(process.argv.slice(2), {
    serverName: SERVER_NAME,
    usage:
      'usage: persona-notes-server --persona-db=<path> [--digest-db=<path>] [--invocation-id=<id>] [--clock-anchor=<iso>]',
    tools: TOOLS,
  }).catch((err: unknown) => {
    console.error('[persona-notes-server] fatal:', err);
    process.exit(1);
  });
}
