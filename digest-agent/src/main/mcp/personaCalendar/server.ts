/**
 * persona-calendar MCP server — test-mode stand-in for a real Google Calendar
 * MCP. Reads `calendar_ops` from persona.db.
 *
 * Tool surface (see `tools.ts`): `list_operations`, `list_events`, `get_event`,
 * `search_events`. Rich enough to serve both live and historical reads.
 */

import { fileURLToPath } from 'node:url';
import {
  createPersonaSubServer,
  runPersonaSubServerCli,
  asPersonaTools,
  type PersonaSubServer,
  type PersonaSubServerOptions,
} from '../_personaServer/buildServer.js';
import { personaCalendarTools } from './tools.js';

const SERVER_NAME = 'digest-persona-calendar';
const TOOLS = asPersonaTools(personaCalendarTools);

export interface PersonaCalendarServerOptions
  extends Omit<PersonaSubServerOptions, 'serverName' | 'tools'> {}

export function createPersonaCalendarServer(
  opts: PersonaCalendarServerOptions,
): PersonaSubServer {
  return createPersonaSubServer({ serverName: SERVER_NAME, tools: TOOLS, ...opts });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runPersonaSubServerCli(process.argv.slice(2), {
    serverName: SERVER_NAME,
    usage:
      'usage: persona-calendar-server --persona-db=<path> [--digest-db=<path>] [--invocation-id=<id>] [--clock-anchor=<iso>]',
    tools: TOOLS,
  }).catch((err: unknown) => {
    console.error('[persona-calendar-server] fatal:', err);
    process.exit(1);
  });
}
