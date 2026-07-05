import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { invokeClaudeCode } from './claudeCode.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-claude-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Write an executable bash script that pretends to be `claude`: parse the
 * digest-injected flags (`--append-system-prompt @<path>`, `--mcp-config <path>`),
 * echo a probe payload to stderr, read stdin to /dev/null, emit a few
 * stream-json lines to stdout, sleep optionally, exit with the given code.
 */
function writeFakeClaude(opts: {
  exitCode?: number;
  emitAssistant?: boolean;
  delaySec?: number;
}): string {
  const path = join(tmp, 'fake-claude.sh');
  const lines = [
    '#!/usr/bin/env bash',
    'set -u',
    'sys_file=""',
    'mcp_file=""',
    'tools=""',
    'while [[ $# -gt 0 ]]; do',
    '  case "$1" in',
    '    --append-system-prompt) sys_file="${2#@}"; shift 2;;',
    '    --mcp-config) mcp_file="$2"; shift 2;;',
    '    --tools) tools="$2"; shift 2;;',
    '    *) shift;;',
    '  esac',
    'done',
    'user_prompt=$(cat)',
    'printf "FAKE_PROBE=%s\\n" "$(printf \'{"sys_file":"%s","mcp_file":"%s","tools":"%s","user_prompt":"%s"}\' "$sys_file" "$mcp_file" "$tools" "${user_prompt//\\"/\\\\\\"}")" >&2',
    'echo "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\"}"',
    ...(opts.emitAssistant
      ? ['echo "{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"done\\"}]}}"']
      : []),
    'echo "{\\"type\\":\\"result\\",\\"subtype\\":\\"success\\"}"',
    ...(opts.delaySec ? [`sleep ${opts.delaySec}`] : []),
    `exit ${opts.exitCode ?? 0}`,
  ];
  writeFileSync(path, lines.join('\n'));
  chmodSync(path, 0o755);
  return path;
}

const minimalMcpConfig = { mcpServers: {} };

describe('invokeClaudeCode', () => {
  it('spawns the binary with staged system + MCP files and pipes stdin', async () => {
    const fake = writeFakeClaude({ emitAssistant: true });

    const outcome = await invokeClaudeCode({
      systemPrompt: 'SYS PROMPT',
      userPrompt: 'USER PROMPT',
      mcpConfig: minimalMcpConfig,
      executable: fake,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.timedOut).toBe(false);
    expect(outcome.stdout).toContain('"type":"assistant"');

    // The fake printed back what it received.
    const probeMatch = /FAKE_PROBE=(.+)/.exec(outcome.stderr);
    expect(probeMatch).toBeTruthy();
    const probe = JSON.parse(probeMatch![1]!.trim()) as {
      sys_file: string;
      mcp_file: string;
      tools: string;
      user_prompt: string;
    };
    expect(probe.sys_file).toMatch(/system\.md$/);
    expect(probe.mcp_file).toMatch(/mcp\.json$/);
    expect(probe.user_prompt).toBe('USER PROMPT');
    // No --tools was passed in this call — flag should be absent.
    expect(probe.tools).toBe('');
  });

  it('passes --tools when the option is set', async () => {
    const fake = writeFakeClaude({ emitAssistant: true });
    const outcome = await invokeClaudeCode({
      systemPrompt: '',
      userPrompt: '',
      mcpConfig: minimalMcpConfig,
      executable: fake,
      tools: ['ToolSearch', 'mcp__digest-substrate', 'mcp__persona-email'],
    });

    const probeMatch = /FAKE_PROBE=(.+)/.exec(outcome.stderr);
    expect(probeMatch).toBeTruthy();
    const probe = JSON.parse(probeMatch![1]!.trim()) as { tools: string };
    expect(probe.tools).toBe('ToolSearch,mcp__digest-substrate,mcp__persona-email');
  });

  it('omits --tools when the list is empty', async () => {
    const fake = writeFakeClaude({ emitAssistant: true });
    const outcome = await invokeClaudeCode({
      systemPrompt: '',
      userPrompt: '',
      mcpConfig: minimalMcpConfig,
      executable: fake,
      tools: [],
    });
    const probeMatch = /FAKE_PROBE=(.+)/.exec(outcome.stderr);
    const probe = JSON.parse(probeMatch![1]!.trim()) as { tools: string };
    expect(probe.tools).toBe('');
  });

  it('parses the final assistant message from stream-json', async () => {
    const fake = writeFakeClaude({ emitAssistant: true });
    const outcome = await invokeClaudeCode({
      systemPrompt: '',
      userPrompt: '',
      mcpConfig: minimalMcpConfig,
      executable: fake,
    });
    expect(outcome.finalMessage).toMatchObject({
      content: [{ type: 'text', text: 'done' }],
    });
  });

  it('reports non-zero exit code without throwing', async () => {
    const fake = writeFakeClaude({ exitCode: 2 });
    const outcome = await invokeClaudeCode({
      systemPrompt: '',
      userPrompt: '',
      mcpConfig: minimalMcpConfig,
      executable: fake,
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.timedOut).toBe(false);
  });

  it('kills the subprocess on timeout and reports timedOut', async () => {
    const fake = writeFakeClaude({ delaySec: 5, emitAssistant: false });
    const outcome = await invokeClaudeCode({
      systemPrompt: '',
      userPrompt: '',
      mcpConfig: minimalMcpConfig,
      executable: fake,
      timeoutMs: 200,
    });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.exitCode !== 0 || outcome.signal !== null).toBe(true);
  });

  it('does not time out when timeoutMs is 0 — runs to natural exit', async () => {
    // Stub sleeps 1s then exits cleanly. With the timeout disabled the call
    // must wait for that exit rather than SIGTERM it early.
    const fake = writeFakeClaude({ delaySec: 1, emitAssistant: true });
    const outcome = await invokeClaudeCode({
      systemPrompt: '',
      userPrompt: '',
      mcpConfig: minimalMcpConfig,
      executable: fake,
      timeoutMs: 0,
    });
    expect(outcome.timedOut).toBe(false);
    expect(outcome.exitCode).toBe(0);
  });

  it('throws when the binary does not exist', async () => {
    await expect(
      invokeClaudeCode({
        systemPrompt: '',
        userPrompt: '',
        mcpConfig: minimalMcpConfig,
        executable: '/no/such/binary',
      }),
    ).rejects.toThrow(/ENOENT|spawn/);
  });
});
