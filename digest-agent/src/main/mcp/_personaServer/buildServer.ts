/**
 * Shared factory for the three test-mode persona MCP servers
 * (persona-email, persona-calendar, persona-notes).
 *
 * Each one opens persona.db read-only, registers its tool catalog, and wires
 * stdio + clock-anchor. The only thing that differs per server is the tool
 * catalog (and the server name advertised over MCP) — everything else is
 * shared here to avoid drift.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { z, type ZodTypeAny } from 'zod';

export type PersonaDb = Database.Database;

export interface PersonaSubServerTool {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: z.ZodType<any, any, any>;
  handler: (
    args: unknown,
    ctx: { personaDb: PersonaDb; now: () => string },
  ) => unknown | Promise<unknown>;
}

export interface PersonaSubServerOptions {
  /** MCP server name advertised on `initialize` (e.g. `digest-persona-email`). */
  serverName: string;
  /** Path to the persona.db (read-only). */
  personaDbPath: string;
  /** Tool catalog this server registers. */
  tools: Record<string, PersonaSubServerTool>;
  /** Override `now()` for tests. */
  now?: () => string;
  /** Frozen ISO timestamp pinned for the subprocess lifetime. */
  clockAnchor?: string;
}

export interface PersonaSubServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  callTool(name: string, args: unknown): Promise<unknown>;
  listTools(): string[];
}

export function createPersonaSubServer(opts: PersonaSubServerOptions): PersonaSubServer {
  if (!existsSync(opts.personaDbPath)) {
    throw new Error(`persona DB not found: ${opts.personaDbPath}`);
  }
  const personaDb = new Database(opts.personaDbPath, {
    readonly: true,
    fileMustExist: true,
  });

  const now =
    opts.now ??
    (opts.clockAnchor !== undefined
      ? () => opts.clockAnchor!
      : () => new Date().toISOString());

  const ctx = { personaDb, now };

  type DispatchOutcome =
    | { ok: true; result: unknown }
    | { ok: false; error: string };

  async function dispatchTool(name: string, args: unknown): Promise<DispatchOutcome> {
    const tool = opts.tools[name];
    if (!tool) {
      return { ok: false, error: `unknown tool: ${name}` };
    }
    let result: unknown;
    let error: string | undefined;
    try {
      const parsed = tool.input.parse(args ?? {});
      result = await tool.handler(parsed, ctx);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return error !== undefined ? { ok: false, error } : { ok: true, result };
  }

  const server = new Server(
    { name: opts.serverName, version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(opts.tools).map(toolToMcp),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const outcome = await dispatchTool(req.params.name, req.params.arguments ?? {});
    if (!outcome.ok) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: outcome.error }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(outcome.result) }],
    };
  });

  let transport: StdioServerTransport | null = null;

  return {
    async start() {
      transport = new StdioServerTransport();
      await server.connect(transport);
    },
    async stop() {
      if (transport) await transport.close();
      personaDb.close();
    },
    async callTool(name, args) {
      const outcome = await dispatchTool(name, args ?? {});
      if (!outcome.ok) throw new Error(outcome.error);
      return outcome.result;
    },
    listTools() {
      return Object.keys(opts.tools);
    },
  };
}

function toolToMcp(tool: PersonaSubServerTool): McpTool {
  const schema = zodToJsonSchema(tool.input, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  delete schema['$schema'];
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema as McpTool['inputSchema'],
  };
}

// ─── CLI entry helper ──────────────────────────────────────────────────────
//
// Each persona sub-server has the same CLI surface — only its tool catalog
// and server name change. This helper centralizes argv parsing + startup so
// each server.ts can be ~20 lines.

export interface PersonaSubServerCliConfig {
  serverName: string;
  /** Usage string shown if required args are missing. */
  usage: string;
  /** The tool catalog to register. */
  tools: Record<string, PersonaSubServerTool>;
}

export async function runPersonaSubServerCli(
  argv: readonly string[],
  config: PersonaSubServerCliConfig,
): Promise<void> {
  const args = parseArgs(argv);
  if (!args['persona-db']) {
    console.error(config.usage);
    process.exit(2);
  }

  const server = createPersonaSubServer({
    serverName: config.serverName,
    personaDbPath: args['persona-db']!,
    tools: config.tools,
    ...(args['clock-anchor'] ? { clockAnchor: args['clock-anchor'] } : {}),
  });
  await server.start();

  process.on('SIGTERM', () => void server.stop().then(() => process.exit(0)));
  process.on('SIGINT', () => void server.stop().then(() => process.exit(0)));
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.+)$/.exec(arg);
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

// Cast helper: each persona-*/tools.ts exports its own narrow tool type, but
// the factory only needs the structural shape. This allows callers to pass
// a typed tool map without explicit casting.
export function asPersonaTools<T extends Record<string, unknown>>(
  m: T,
): Record<string, PersonaSubServerTool> {
  return m as unknown as Record<string, PersonaSubServerTool>;
}

// Re-export `z` for sub-server tool modules that want it without an extra import.
export { z, type ZodTypeAny };
