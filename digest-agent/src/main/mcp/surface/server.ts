/**
 * Surface MCP server — the principal's `/digest` integration in Claude Code.
 *
 * Spawned by the principal's Claude Code instance per their `~/.claude/mcp.json`
 * config entry, e.g.:
 *
 *   {
 *     "mcpServers": {
 *       "digest": {
 *         "command": "<electron-binary>",
 *         "args": ["dist/main/mcp/surface/server.js", "--db=…", "--digest-dir=…"],
 *         "env": { "ELECTRON_RUN_AS_NODE": "1" }
 *       }
 *     }
 *   }
 *
 * Like the substrate server (Phase 7), this must be invoked under Electron's
 * bundled Node (ELECTRON_RUN_AS_NODE=1) so the native better-sqlite3 module
 * ABI matches.
 *
 * Five tools: digest_get, digest_run, diary_act, diary_add_comment,
 * diary_add_note. The latter four enqueue a row in pending_bus_events that
 * main's event-relay subsystem drains and re-emits on the in-process bus.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { openDatabase, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { migrationsDir } from '../../db/migrations-path.js';
import { surfaceTools } from './tools.js';
import type { AnyTool, ToolContext } from '../substrate/tool.js';

export interface SurfaceServerOptions {
  dbPath: string;
  digestDir: string;
  now?: () => string;
  /** Test override — shortcut digest_run polling. */
  diaryRunPollMs?: number;
  diaryRunTimeoutMs?: number;
}

export interface SurfaceServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  callTool(name: string, args: unknown): Promise<unknown>;
  listTools(): string[];
}

export function createSurfaceServer(opts: SurfaceServerOptions): SurfaceServer {
  const db = openDatabase(opts.dbPath);
  applyMigrations(db, migrationsDir());

  const ctx: ToolContext & {
    diaryRunPollMs?: number;
    diaryRunTimeoutMs?: number;
  } = {
    db,
    digestDir: opts.digestDir,
    now: opts.now ?? (() => new Date().toISOString()),
    ...(opts.diaryRunPollMs !== undefined ? { diaryRunPollMs: opts.diaryRunPollMs } : {}),
    ...(opts.diaryRunTimeoutMs !== undefined
      ? { diaryRunTimeoutMs: opts.diaryRunTimeoutMs }
      : {}),
  };

  const server = new Server(
    { name: 'digest-surface', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const tools = surfaceTools as unknown as Record<string, AnyTool>;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(tools).map((t) => toolToMcp(t)),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const tool = tools[name];
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `unknown tool: ${name}` }],
      };
    }
    try {
      const parsed = tool.input.parse(req.params.arguments ?? {});
      const result = await tool.handler(parsed, ctx);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: 'text' as const, text: message }] };
    }
  });

  let transport: StdioServerTransport | null = null;

  return {
    async start() {
      transport = new StdioServerTransport();
      await server.connect(transport);
    },
    async stop() {
      if (transport) await transport.close();
      db.close();
    },
    async callTool(name, args) {
      const tool = tools[name];
      if (!tool) throw new Error(`unknown tool: ${name}`);
      const parsed = tool.input.parse(args ?? {});
      return tool.handler(parsed, ctx);
    },
    listTools() {
      return Object.keys(surfaceTools);
    },
  };
}

function toolToMcp(tool: AnyTool): McpTool {
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

// CLI entry — used when this module is run via `node dist/main/mcp/surface/server.js`.
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args['db'] || !args['digest-dir']) {
    console.error('usage: surface-server --db=<path> --digest-dir=<path>');
    process.exit(2);
  }
  const server = createSurfaceServer({ dbPath: args['db']!, digestDir: args['digest-dir']! });
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

import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error('[surface-server] fatal:', err);
    process.exit(1);
  });
}

export type { Db };
