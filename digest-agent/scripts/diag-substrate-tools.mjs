#!/usr/bin/env node
// Diagnostic: spawn the substrate MCP server with --role=cold-start, complete
// the MCP handshake over stdio, request tools/list, print exactly what
// Claude Code would see. Empirical answer to "why didn't the tools surface."

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const role = process.argv[2] ?? 'cold-start';
const tmp = mkdtempSync(join(tmpdir(), `diag-substrate-${role}-`));
const digestDir = tmp;
const dbPath = join(tmp, 'digest.db');
mkdirSync(join(tmp, 'plays'), { recursive: true });

const serverScript = join(REPO_ROOT, 'dist', 'main', 'mcp', 'substrate', 'server.js');
const electron = join(REPO_ROOT, 'node_modules', '.bin', 'electron');

console.log(`[diag] role=${role}`);
console.log(`[diag] db=${dbPath}`);
console.log(`[diag] server=${serverScript}`);

// Spawn substrate server via electron-as-node (same as production dispatcher).
const transport = new StdioClientTransport({
  command: electron,
  args: [
    serverScript,
    `--role=${role}`,
    `--db=${dbPath}`,
    `--digest-dir=${digestDir}`,
  ],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stderr: 'pipe',
});

// Capture stderr separately so we see any startup errors.
let stderrBuf = '';
transport.stderr?.on('data', (chunk) => {
  stderrBuf += chunk.toString();
});

const client = new Client({ name: 'diag', version: '0.0.0' }, { capabilities: {} });

const t0 = Date.now();
try {
  await client.connect(transport);
  console.log(`[diag] connected in ${Date.now() - t0}ms`);
} catch (err) {
  console.error('[diag] connect FAILED:', err.message);
  console.error('[diag] stderr so far:', stderrBuf.slice(0, 2000));
  process.exit(1);
}

let res;
try {
  res = await client.listTools();
} catch (err) {
  console.error('[diag] tools/list FAILED:', err.message);
  console.error('[diag] stderr so far:', stderrBuf.slice(0, 3000));
  process.exit(1);
}

const tools = res.tools ?? [];
console.log(`[diag] tools/list returned ${tools.length} tools:`);
for (const t of tools) {
  // Sanity-check inputSchema serializability.
  let schemaOk = false;
  let schemaErr = '';
  try {
    const s = JSON.stringify(t.inputSchema ?? {});
    schemaOk = typeof t.inputSchema === 'object' && t.inputSchema !== null;
    if (s.length > 50_000) schemaErr = `large(${s.length})`;
  } catch (e) {
    schemaErr = e.message;
  }
  console.log(`  - ${t.name.padEnd(30)} desc=${(t.description ?? '').length} chars  schema=${schemaOk ? 'ok' : 'BAD'}  ${schemaErr}`);
}

if (stderrBuf.trim()) {
  console.log('\n[diag] server stderr:');
  console.log(stderrBuf);
}

await client.close();
process.exit(0);
