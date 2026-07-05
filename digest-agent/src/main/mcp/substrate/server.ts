/**
 * Substrate MCP server — runs as a subprocess of the Electron main.
 *
 * Spawned by main (Phase 8's dispatchers). Because `better-sqlite3` is a
 * native module compiled against Electron's bundled Node ABI, the subprocess
 * MUST run under Electron's Node, NOT the system `node` binary. There are
 * two equivalent patterns:
 *
 *   1. `ELECTRON_RUN_AS_NODE=1 <electronBinary> dist/main/mcp/substrate/server.js \
 *         --role=... --db=... --digest-dir=...`
 *      Use process.execPath to get the Electron binary.
 *
 *   2. utilityProcess.fork(script, args)  — Electron 22+; preferred when main
 *      doesn't need stdio piping to the subprocess (we DO need stdio for MCP
 *      transport, so option 1 is what Phase 8 uses).
 *
 * Standalone smoke testing via the system `node` works only when better-sqlite3
 * has been rebuilt with `npm rebuild` for the system Node ABI (see `npm run
 * rebuild:node`); production spawn under Electron uses the Electron-built ABI.
 *
 * Opens its own SQLite connection (WAL keeps it coherent with main's
 * connection) and registers exactly the role's tool allowlist. Communicates
 * with the Claude Code subprocess (spawned by a dispatcher and pointed at
 * this server via --mcp-config) over stdio MCP.
 *
 * No bus access — the substrate MCP server only mutates SQLite. Bus events
 * downstream of substrate writes (e.g. "a reminder was set, so the reminder
 * scheduler should re-check the table") are triggered by the dispatcher
 * emitting `mind.invocation.done` after the Claude Code subprocess exits;
 * the reminder scheduler subscribes to that and re-reads the table.
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
import { openDatabase, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { migrationsDir } from '../../db/migrations-path.js';
import { toolsForRole, type SubstrateRole } from './catalog.js';
import type { AnyTool, ToolContext } from './tool.js';

export interface SubstrateServerOptions {
  role: SubstrateRole;
  dbPath: string;
  digestDir: string;
  /**
   * Override `now()` for tests. Production uses either the wall clock (when
   * `clockAnchor` is unset) or a frozen anchor (when test mode passes one in).
   */
  now?: () => string;
  /**
   * ISO-8601 timestamp to use as `now()` for the lifetime of this subprocess.
   * Set by the dispatcher at spawn time from `clock.now()`. In test mode this
   * carries the simulated clock; substrate writes (anchor.last_bumped,
   * entity.last_seen, prediction.created_at, etc.) then record sim-time, not
   * wall-time.
   *
   * Frozen-at-spawn is correct because the simulated clock does not advance
   * during a single agent invocation — the persona-clock driver only advances
   * the clock on `mind.invocation.done`, which fires AFTER this subprocess
   * exits. Anything else passed by the dispatcher is wall-time and identical
   * to the fallback.
   */
  clockAnchor?: string;
}

export interface SubstrateServer {
  /** Start the stdio transport. Resolves after `initialize`. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Test-friendly entry: invoke a tool directly without going through stdio. */
  callTool(name: string, args: unknown): Promise<unknown>;
  /** List the registered tool names. */
  listTools(): string[];
}

export function createSubstrateServer(opts: SubstrateServerOptions): SubstrateServer {
  const db = openDatabase(opts.dbPath);
  // Migrations are idempotent. Apply here in case main hasn't yet.
  applyMigrations(db, migrationsDir());

  // `run_sql` is read-only for every role — the connection layer enforces it.
  // Mind / cold-start mutations go through the typed write tools (which use
  // the read-write `db` handle); diary never mutates the mind model.
  const roDb = new Database(opts.dbPath, { readonly: true, fileMustExist: true });

  const tools = toolsForRole(opts.role);
  const now =
    opts.now ??
    (opts.clockAnchor !== undefined
      ? () => opts.clockAnchor!
      : () => new Date().toISOString());
  const ctx: ToolContext = {
    db,
    ...(roDb ? { roDb } : {}),
    role: opts.role,
    digestDir: opts.digestDir,
    now,
  };
  type DispatchOutcome =
    | { ok: true; result: unknown }
    | { ok: false; error: string };

  async function dispatchTool(name: string, args: unknown): Promise<DispatchOutcome> {
    const tool = tools[name];
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
    { name: `digest-substrate-${opts.role}`, version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(tools).map(toolToMcp),
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
      roDb?.close();
      db.close();
    },
    async callTool(name, args) {
      const outcome = await dispatchTool(name, args ?? {});
      if (!outcome.ok) throw new Error(outcome.error);
      return outcome.result;
    },
    listTools() {
      return Object.keys(tools);
    },
  };
}

export function toolToMcp(tool: AnyTool): McpTool {
  const schema = zodToJsonSchema(tool.input, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  // MCP wants `inputSchema`; drop the JSON Schema $schema field for cleanliness.
  delete schema['$schema'];
  // Fail loudly at registration time if a tool's top-level schema is not an
  // object — the MCP spec requires inputSchema.type === "object", and a
  // discriminated union / array / etc. at the top level breaks tools/list
  // for the whole server. Surfacing it here turns "Claude Code sees zero
  // substrate tools" into "the substrate server refuses to start."
  if (schema['type'] !== 'object') {
    throw new Error(
      `substrate tool "${tool.name}" has a non-object top-level inputSchema (type=${JSON.stringify(schema['type'])}). MCP requires \`type: "object"\` at the root — wrap discriminated unions inside z.object(...).strict() or split into separate tools.`,
    );
  }
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema as McpTool['inputSchema'],
  };
}

/** CLI entry — used when this module is run via `node dist/main/mcp/substrate/server.js`. */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args['role'] || !args['db'] || !args['digest-dir']) {
    console.error(
      'usage: substrate-server --role=<mind|diary|cold-start> --db=<path> --digest-dir=<path>',
    );
    process.exit(2);
  }
  const role = args['role'] as SubstrateRole;
  if (!['mind', 'diary', 'cold-start'].includes(role)) {
    console.error(`invalid role: ${role}`);
    process.exit(2);
  }

  const server = createSubstrateServer({
    role,
    dbPath: args['db']!,
    digestDir: args['digest-dir']!,
    ...(args['clock-anchor'] ? { clockAnchor: args['clock-anchor'] } : {}),
  });
  await server.start();

  process.on('SIGTERM', () => void server.stop().then(() => process.exit(0)));
  process.on('SIGINT', () => void server.stop().then(() => process.exit(0)));
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.+)$/.exec(arg);
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

// Run main() if invoked directly. The compiled file's URL ends with /server.js;
// if argv[1] matches, we're the entry point.
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error('[substrate-server] fatal:', err);
    process.exit(1);
  });
}

// Helper for unused import — `Db` is part of the public type surface above.
export type { Db };
