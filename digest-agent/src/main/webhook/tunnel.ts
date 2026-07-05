/**
 * Tunnel manager — spawns and supervises an ngrok subprocess that exposes
 * the local webhook server to the public internet.
 *
 * Architecture: design/08-runtime.md § "Subsystem 2: tunnel manager"
 *
 * Behavior:
 *  - Spawns `ngrok http <port>` (with `--domain` if a reserved domain is set).
 *  - Tails stdout/stderr; parses the public URL (`url=https://...` lines).
 *  - Emits `tunnel.up` with the public URL when ngrok announces it.
 *  - Emits `tunnel.down` if the subprocess exits unexpectedly.
 *  - Auto-restarts with exponential backoff (cap: 60s).
 *  - If `webhook.tunnel.kind === 'external'`, this manager is inactive — the
 *    user runs their own tunnel (Cloudflare Tunnel, Tailscale Funnel, etc.).
 *
 * Auth: reads `webhook.tunnel.authtoken_env` (default NGROK_AUTHTOKEN) and
 * exports it to the ngrok subprocess via env. We do NOT shell out to
 * `ngrok config add-authtoken` — the env-var approach keeps the token
 * scoped to this subprocess and avoids touching the user's global ngrok config.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Bus } from '../bus.js';
import type { AppConfig } from '@shared/types/config.js';

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 500;

export interface TunnelManager {
  start(): void;
  stop(): Promise<void>;
  /** Last public URL seen from ngrok (null until tunnel.up fires). */
  publicUrl(): string | null;
}

export interface TunnelOptions {
  /** Override the binary used. Defaults to `ngrok` on PATH. */
  ngrokBin?: string;
  /** For tests — disables actual spawn; the manager logs intent only. */
  dryRun?: boolean;
}

export function createTunnelManager(
  config: AppConfig,
  bus: Bus,
  opts: TunnelOptions = {},
): TunnelManager {
  const tunnel = config.webhook.tunnel;
  const port = config.webhook.bind_port;

  let child: ChildProcess | null = null;
  let stopped = false;
  let backoff = INITIAL_BACKOFF_MS;
  let lastUrl: string | null = null;
  let restartTimer: NodeJS.Timeout | null = null;

  function inactive(): boolean {
    return !tunnel || tunnel.kind === 'external';
  }

  function spawnOnce(): void {
    if (inactive() || stopped || opts.dryRun) return;

    const bin = opts.ngrokBin ?? 'ngrok';
    const args = ['http', String(port), '--log=stdout', '--log-format=logfmt'];
    if (tunnel?.domain) {
      args.push(`--domain=${tunnel.domain}`);
    }

    const env = { ...process.env };
    const tokenVar = tunnel?.authtoken_env ?? 'NGROK_AUTHTOKEN';
    const token = process.env[tokenVar];
    if (token) env['NGROK_AUTHTOKEN'] = token;

    child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    child.on('error', (err) => {
      console.error('[tunnel] ngrok spawn error:', err.message);
      void bus.emit('tunnel.down', { reason: `spawn error: ${err.message}` });
      scheduleRestart();
    });

    child.on('exit', (code, signal) => {
      if (!stopped) {
        console.warn(`[tunnel] ngrok exited code=${code} signal=${signal}; restarting`);
        void bus.emit('tunnel.down', { reason: `exited code=${code} signal=${signal}` });
        scheduleRestart();
      }
    });

    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const match = /url=(https?:\/\/[^\s"']+)/.exec(text);
      if (match && match[1] && match[1] !== lastUrl) {
        lastUrl = match[1];
        backoff = INITIAL_BACKOFF_MS;
        void bus.emit('tunnel.up', { public_url: match[1] });
      }
    };

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', (chunk: Buffer) => {
      // ngrok writes some non-fatal info to stderr; capture both.
      onStdout(chunk);
    });
  }

  function scheduleRestart(): void {
    if (stopped || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      spawnOnce();
    }, backoff);
  }

  return {
    start() {
      if (inactive()) {
        console.log('[tunnel] external mode — manager inactive');
        return;
      }
      stopped = false;
      spawnOnce();
    },
    async stop() {
      stopped = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      if (child && child.exitCode === null && child.signalCode === null) {
        // Still alive — TERM, then SIGKILL after 2s if it hasn't exited.
        const c = child;
        c.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          // Check once more in case the child exited between the kill() call
          // and our listener attachment.
          if (c.exitCode !== null || c.signalCode !== null) return resolve();
          const timeout = setTimeout(() => {
            c.kill('SIGKILL');
            resolve();
          }, 2000);
          c.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      child = null;
    },
    publicUrl() {
      return lastUrl;
    },
  };
}
