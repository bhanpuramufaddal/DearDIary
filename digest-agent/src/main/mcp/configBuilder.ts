/**
 * MCP config builder.
 *
 * Each agent invocation is a Claude Code subprocess. Claude Code reads
 * `--mcp-config <path>` and spawns the listed MCP servers itself (the
 * standard MCP plugin pattern — one server per Claude Code session).
 *
 * For our SUBSTRATE MCP server (mind / diary / cold-start), we spawn under
 * Electron's bundled Node (via `process.execPath` + `ELECTRON_RUN_AS_NODE=1`)
 * so the native `better-sqlite3` ABI matches. For external MCPs (gmail-mcp,
 * persona-emulator-mcp, etc.), the commands come from `config.mcp_servers`
 * verbatim — they're typically `uvx`-launched Python or other-runtime servers.
 *
 * The substrate server's `digest-dir` argument lets the read tools find
 * profile.md and plays/; the `db` argument is the SQLite path.
 */

import type { AppConfig } from '@shared/types/config.js';
import type { AgentRole } from '../prompts.js';

export interface McpConfigBuilderOptions {
  /**
   * Path to the substrate MCP server bundle (post-esbuild). Defaults to the
   * conventional `dist/main/mcp/substrate/server.js` relative to digest_dir's
   * parent — overridable for tests.
   */
  substrateServerPath: string;
  /** SQLite database path. */
  dbPath: string;
  /** Digest data directory (profile.md, plays/, etc.). */
  digestDir: string;
  /**
   * Executable to spawn the substrate server with. In production this is
   * Electron's binary (process.execPath) with ELECTRON_RUN_AS_NODE=1 so the
   * native better-sqlite3 module's ABI matches. Tests override to plain node.
   */
  nodeExecutable: string;
  /** Env passed to the substrate server subprocess. */
  nodeExecutableEnv?: Record<string, string>;
  /**
   * ISO-8601 timestamp for the substrate's `now()`. In test mode, this is
   * the simulated clock at spawn time; substrate writes record sim-time.
   * In production, equivalent to wall-clock at spawn (and identical to the
   * fallback if omitted).
   */
  clockAnchor?: string;
  /**
   * Test-mode persona-services MCP injection. When set, three MCP servers
   * (`persona-email`, `persona-calendar`, `persona-notes`) are added to the
   * agent's config. Each reads from the persona's `persona.db` read-only and
   * exposes rich tool surfaces (date-range queries, by-id lookups, search) so
   * the same MCPs serve BOTH live queries and historical snapshots — there's
   * no separate "history" server.
   *
   * Production cold-start / diary / mind talk to the user's real Gmail /
   * Calendar / Notes MCPs listed in `agent_mcp_access` instead — those paths
   * are unchanged. This injection only fires in test mode (DIGEST_TEST_CLOCK
   * set) and is the test-fixture substitute for those production MCPs.
   */
  personaServices?: {
    /** Compiled persona-email server bundle path. */
    emailServerPath: string;
    /** Compiled persona-calendar server bundle path. */
    calendarServerPath: string;
    /** Compiled persona-notes server bundle path. */
    notesServerPath: string;
    /** Absolute path to the persona's persona.db (read-only). */
    personaDbPath: string;
  };
}

export interface McpConfigJson {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  >;
}

const SUBSTRATE_ROLE: Record<AgentRole, string | null> = {
  mind: 'mind',
  diary: 'diary',
  'cold-start': 'cold-start',
  // Execution agents (Phase 11) have NO substrate access — they only act on
  // the world via external MCPs (Gmail, Calendar, …).
  execution: null,
};

export function buildMcpConfig(
  role: AgentRole,
  config: AppConfig,
  opts: McpConfigBuilderOptions,
): McpConfigJson {
  const mcpServers: McpConfigJson['mcpServers'] = {};

  // ─── Substrate MCP (skipped for execution agents) ────────────────────────
  const substrateRole = SUBSTRATE_ROLE[role];
  if (substrateRole !== null) {
    const args = [
      opts.substrateServerPath,
      `--role=${substrateRole}`,
      `--db=${opts.dbPath}`,
      `--digest-dir=${opts.digestDir}`,
    ];
    if (opts.clockAnchor) args.push(`--clock-anchor=${opts.clockAnchor}`);
    mcpServers['digest-substrate'] = {
      command: opts.nodeExecutable,
      args,
      ...(opts.nodeExecutableEnv ? { env: opts.nodeExecutableEnv } : {}),
    };
  }

  // ─── Persona-services (test mode: email / calendar / notes) ──────────────
  // Wired for cold-start, diary, and mind. Not for execution — it acts through
  // real MCPs only.
  if (opts.personaServices && (role === 'cold-start' || role === 'diary' || role === 'mind')) {
    const ps = opts.personaServices;
    const personaArgs = (serverPath: string): string[] => {
      const args = [serverPath, `--persona-db=${ps.personaDbPath}`];
      if (opts.clockAnchor) args.push(`--clock-anchor=${opts.clockAnchor}`);
      return args;
    };
    const nodeServer = (serverPath: string) => ({
      command: opts.nodeExecutable,
      args: personaArgs(serverPath),
      ...(opts.nodeExecutableEnv ? { env: opts.nodeExecutableEnv } : {}),
    });
    mcpServers['persona-email'] = nodeServer(ps.emailServerPath);
    mcpServers['persona-calendar'] = nodeServer(ps.calendarServerPath);
    mcpServers['persona-notes'] = nodeServer(ps.notesServerPath);
  }

  // ─── External MCPs the role can access ───────────────────────────────────
  const allowedIds = role === 'execution' ? execAllowedMcps(config) : roleAllowedMcps(role, config);
  for (const serverId of allowedIds) {
    const server = config.mcp_servers.find((s) => s.id === serverId);
    if (!server) {
      // Configured allowlist references an MCP id that isn't registered —
      // skip silently; validation happens at config-load time.
      continue;
    }
    const { command, args } = splitCommand(server.command);
    mcpServers[serverId] = {
      command,
      args,
      ...(server.env ? { env: server.env } : {}),
    };
  }

  return { mcpServers };
}

function roleAllowedMcps(role: AgentRole, config: AppConfig): readonly string[] {
  const key = role === 'cold-start' ? 'cold_start' : role;
  return config.agent_mcp_access[key as 'mind' | 'diary' | 'cold_start'] ?? [];
}

/**
 * Execution agents (Phase 11) are spawned per task. They get every external
 * MCP server configured, since their job is to act on the world and they
 * shouldn't be artificially limited at this layer (the action's `kind` field
 * scopes what they're being asked to do).
 */
function execAllowedMcps(config: AppConfig): readonly string[] {
  return config.mcp_servers.map((s) => s.id);
}

/**
 * Parse a config-style command string ("uvx gmail-mcp --account a@b.com") into
 * argv. Space-split only — not shell-quote-aware; adequate for simple
 * `<binary> <flags>` shapes which cover all practical MCP server commands.
 */
function splitCommand(s: string): { command: string; args: string[] } {
  const parts = s.trim().split(/\s+/);
  if (!parts[0]) throw new Error(`mcp_servers entry has empty command: ${JSON.stringify(s)}`);
  return { command: parts[0], args: parts.slice(1) };
}
