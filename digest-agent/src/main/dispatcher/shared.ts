/**
 * Shared dispatcher utilities.
 *
 * IdleGate               — busy/idle tracking for serializing dispatchers (mind, diary, cold-start).
 * coreBuilderOpts        — converts common dispatcher opts into McpConfigBuilderOptions.
 * buildDispatcherMcpConfig — builds the full MCP config for any agent role.
 * agentTools             — builds the --tools allowlist from an MCP config.
 *
 * Why --tools matters: it is the only Claude Code flag that removes tools from the model's
 * context. We allowlist MCP servers + ToolSearch; local-fs and shell tools are blocked by
 * exclusion. `--allowedTools` / `--disallowedTools` only affect permission prompts — don't
 * confuse them with `--tools`.
 */

import type { AppConfig } from '@shared/types/config.js';
import type { McpConfigJson, McpConfigBuilderOptions } from '../mcp/configBuilder.js';
import type { AgentRole } from '../prompts.js';
import type { Clock } from '../clock.js';
import { buildMcpConfig } from '../mcp/configBuilder.js';

export interface BaseDispatcherOpts {
  substrateServerPath: string;
  nodeExecutable?: string;
  nodeExecutableEnv?: Record<string, string>;
}

/** Persona-services MCP wiring used by cognitive dispatchers in test mode. */
export interface PersonaServices {
  emailServerPath: string;
  calendarServerPath: string;
  notesServerPath: string;
  personaDbPath: string;
}

/**
 * Manages busy/idle state for serializing dispatchers.
 * Call setBusy() before an invocation and setIdle() in its finally block.
 */
export class IdleGate {
  private busy = false;
  private resolvers: Array<() => void> = [];

  isBusy(): boolean { return this.busy; }
  setBusy(): void { this.busy = true; }

  setIdle(): void {
    this.busy = false;
    const rs = this.resolvers.splice(0);
    for (const r of rs) r();
  }

  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise<void>((resolve) => this.resolvers.push(resolve));
  }
}

/** Build the base McpConfigBuilderOptions from dispatcher opts + config. */
export function coreBuilderOpts(config: AppConfig, opts: BaseDispatcherOpts): McpConfigBuilderOptions {
  return {
    substrateServerPath: opts.substrateServerPath,
    dbPath: `${config.digest_dir}/digest.db`,
    digestDir: config.digest_dir,
    nodeExecutable: opts.nodeExecutable ?? process.execPath,
    nodeExecutableEnv: opts.nodeExecutableEnv ?? { ELECTRON_RUN_AS_NODE: '1' },
  };
}

/** Build the full MCP config for a dispatcher role, including clock anchor and persona-services. */
export function buildDispatcherMcpConfig(
  role: AgentRole,
  config: AppConfig,
  opts: BaseDispatcherOpts & { clock?: Clock; personaServices?: PersonaServices },
): McpConfigJson {
  return buildMcpConfig(role, config, {
    ...coreBuilderOpts(config, opts),
    ...(opts.clock ? { clockAnchor: opts.clock.now().toISOString() } : {}),
    ...(opts.personaServices ? { personaServices: opts.personaServices } : {}),
  });
}

/** Build the --tools allowlist: every MCP server as `mcp__<id>` + ToolSearch. */
export function agentTools(mcpConfig: McpConfigJson): string[] {
  return [...Object.keys(mcpConfig.mcpServers).map((s) => `mcp__${s}`), 'ToolSearch'];
}
