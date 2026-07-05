/**
 * Claude Code launcher — spawns the `claude` CLI in headless permissionless mode.
 *
 * Architecture: design/11-backend-architecture.md § "Agent runtime".
 * The launcher is injectable: `opts.spawn` lets tests substitute a mock.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpConfigJson } from './mcp/configBuilder.js';

export interface ClaudeCodeInvocation {
  /** Composed system prompt (disposition + role-specific). */
  systemPrompt: string;
  /** The user-facing input. For mind: serialized event payload. */
  userPrompt: string;
  /** MCP config object — will be written to a temp file and passed via --mcp-config. */
  mcpConfig: McpConfigJson;
  /** Working directory for the subprocess. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Hard timeout in ms. Default 5 minutes. Pass `0` (or any non-positive /
   * non-finite value) to disable the timeout entirely — the subprocess runs
   * until it exits on its own. Used by cold-start, which is a one-time boot
   * step with no recurring tick to fall back on, so a spurious timeout there
   * just leaves the substrate empty.
   */
  timeoutMs?: number;
  /** Override the `claude` executable path. Defaults to "claude" on PATH. */
  executable?: string;
  /**
   * Model id passed as `--model <id>` (e.g. 'claude-sonnet-4-6'). Pins the
   * subprocess to a specific model per agent role; omit to use the `claude`
   * CLI's default. Inserted before `extraFlags` so an explicit `--model` in
   * extraFlags still wins (last flag on the line takes precedence).
   */
  model?: string;
  /** Extra CLI flags. */
  extraFlags?: string[];
  /**
   * Restricted tool surface for the agent. Becomes `--tools <csv>` — the
   * Claude Code flag that actually removes tools from the model's context
   * (per https://code.claude.com/docs/en/cli-reference.md). Built-in tool
   * names (`Read`, `Bash`, `ToolSearch`, …) go in as-is; MCP tools as
   * `mcp__<server>` (whole server) or `mcp__<server>__<tool>`. Omit to
   * keep the full default surface.
   *
   * Note: `--allowedTools` / `--disallowedTools` are *different* flags
   * that only affect permission prompts, not tool availability. Don't
   * confuse them with `--tools`.
   */
  tools?: string[];
  /**
   * Extra env vars to merge into the subprocess. Used by the telemetry layer
   * to pass `TRACEPARENT` + `CLAUDE_CODE_ENABLE_TELEMETRY` + the OTLP
   * exporter config so Claude Code's native OTel spans nest under our parent
   * span and ship to Langfuse. Empty `{}` is a safe default (no-op).
   */
  telemetryEnv?: Record<string, string>;
  /** Test-injectable spawn function. */
  spawn?: typeof nodeSpawn;
}

export interface ClaudeCodeOutcome {
  exitCode: number;
  signal: NodeJS.Signals | null;
  durationMs: number;
  /** Full captured stdout. */
  stdout: string;
  /** Full captured stderr. */
  stderr: string;
  /**
   * Best-effort structured outcome parsed from the stream-json output —
   * the final assistant message's content. `null` if parsing failed.
   */
  finalMessage: unknown | null;
  /** True if killed because of timeout. */
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Spawn a Claude Code subprocess. Resolves when the subprocess exits.
 */
export async function invokeClaudeCode(opts: ClaudeCodeInvocation): Promise<ClaudeCodeOutcome> {
  const executable = opts.executable ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawn = opts.spawn ?? nodeSpawn;

  // Stage the MCP config and system prompt in a temp dir.
  const stage = mkdtempSync(join(tmpdir(), 'digest-claude-'));
  const mcpConfigPath = join(stage, 'mcp.json');
  const sysPromptPath = join(stage, 'system.md');

  writeFileSync(mcpConfigPath, JSON.stringify(opts.mcpConfig, null, 2));
  writeFileSync(sysPromptPath, opts.systemPrompt);

  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format',
    'stream-json',
    '--verbose',
    '--append-system-prompt',
    `@${sysPromptPath}`,
    '--mcp-config',
    mcpConfigPath,
    ...(opts.tools && opts.tools.length > 0
      ? ['--tools', opts.tools.join(',')]
      : []),
    ...(opts.model ? ['--model', opts.model] : []),
    ...(opts.extraFlags ?? []),
  ];

  const spawnOptions: SpawnOptions = {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(opts.telemetryEnv ?? {}) },
  };

  const start = Date.now();
  const child: ChildProcess = spawn(executable, args, spawnOptions);

  // stdio: 'pipe' guarantees non-null streams — assert rather than guard.
  child.stdin!.end(opts.userPrompt);

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout!.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr!.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  // timeoutMs <= 0 (or non-finite) disables the timeout — no watchdog timer.
  const timeoutEnabled = Number.isFinite(timeoutMs) && timeoutMs > 0;
  let timedOut = false;
  const timeoutHandle = timeoutEnabled
    ? setTimeout(() => {
        timedOut = true;
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          // Hard-kill after a short grace.
          setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          }, 2000);
        }
      }, timeoutMs)
    : null;

  let spawnError: Error | undefined;
  const { exitCode, signal } = await new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once('exit', (code, sig) =>
        resolve({ exitCode: code ?? -1, signal: sig as NodeJS.Signals | null }),
      );
      child.once('error', (err) => {
        // Capture spawn error but resolve so cleanup still runs; throw below.
        spawnError = err;
        resolve({ exitCode: -1, signal: null });
      });
    },
  );

  if (timeoutHandle) clearTimeout(timeoutHandle);

  const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
  const stderr = Buffer.concat(stderrChunks).toString('utf-8');

  rmSync(stage, { recursive: true, force: true });

  if (spawnError) throw spawnError;

  return {
    exitCode,
    signal,
    durationMs: Date.now() - start,
    stdout,
    stderr,
    finalMessage: parseFinalMessage(stdout),
    timedOut,
  };
}

/**
 * Parse the last `assistant` message from a Claude Code stream-json stdout.
 * Each line is a JSON object; the final assistant turn carries the structured
 * answer. Falls back to the `result` line if no `assistant` is present.
 * Returns null if neither is found.
 */
function parseFinalMessage(stdout: string): unknown | null {
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  let lastAssistant: unknown | null = null;
  let lastResult: unknown | null = null;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as { type?: string; message?: unknown };
      if (obj.type === 'assistant' && obj.message) lastAssistant = obj.message;
      else if (obj.type === 'result') lastResult = obj;
    } catch {
      // Non-JSON lines (startup banners, version strings) — skip.
    }
  }
  return lastAssistant ?? lastResult;
}
