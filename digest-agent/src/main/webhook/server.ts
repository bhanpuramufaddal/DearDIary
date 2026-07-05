/**
 * Webhook server.
 *
 * Fastify on loopback. Each external event source (Gmail, GCal, …) will
 * register a route here in future phases. For now the only route is
 * `/health` — the persona-emulator no longer uses HTTP (it runs in-process
 * via src/main/test/personaEmulator.ts).
 *
 * Architecture: design/08-runtime.md § "Subsystem 1: webhook server"
 *               design/11-backend-architecture.md (Webhook server in main process)
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { Bus } from '../bus.js';
import type { AppConfig } from '@shared/types/config.js';

export interface WebhookServer {
  fastify: FastifyInstance;
  listen(): Promise<{ address: string; port: number }>;
  close(): Promise<void>;
}

export interface WebhookServerOptions {
  /** Override clock for testing. */
  now?: () => string;
}

/**
 * Build a webhook server. Future event-source adapters (Gmail, GCal, …) will
 * register their routes here. The persona-emulator does NOT live here — it
 * runs in-process and emits directly on the bus.
 */
export function createWebhookServer(
  config: AppConfig,
  _bus: Bus,
  _opts: WebhookServerOptions = {},
): WebhookServer {
  const fastify = Fastify({ logger: false });

  fastify.get('/health', async () => ({ ok: true }));

  return {
    fastify,
    async listen() {
      const address = await fastify.listen({
        host: config.webhook.bind_host,
        port: config.webhook.bind_port,
      });
      const url = new URL(address.startsWith('http') ? address : `http://${address}`);
      return { address, port: Number(url.port) || config.webhook.bind_port };
    },
    async close() {
      await fastify.close();
    },
  };
}
