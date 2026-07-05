/**
 * Substrate-MCP tool framework.
 *
 * Each tool is a small bundle of name, description, zod input schema, and a
 * handler that runs against the SQLite database. The role catalog (catalog.ts)
 * lists which tools each agent role registers; the server (server.ts) wires
 * them onto the MCP transport.
 *
 * Why zod for the input schema: it gives us both compile-time TypeScript types
 * (`z.infer<typeof T>`) and runtime validation, with one source of truth that
 * we can serialize to JSON Schema for MCP's `tools/list` response.
 */

import { z, type ZodTypeAny } from 'zod';
import type { Db } from '../../db/index.js';

export interface ToolContext {
  db: Db;
  /**
   * Read-only connection to the same DB, used by `run_sql` for the diary role
   * so any attempted mutation throws at the SQLite layer. Mind / cold-start
   * leave this undefined and run SQL against the read-write `db`.
   */
  roDb?: Db;
  /** The agent role this server is serving (mind / diary / cold-start). */
  role?: 'mind' | 'diary' | 'cold-start';
  /** Resolved at boot from the spawned subprocess's argv. */
  digestDir: string;
  /** Override clock — tests pass a fixed clock; production passes Date.now() based. */
  now: () => string;
}

export interface Tool<I extends ZodTypeAny = ZodTypeAny, O = unknown> {
  name: string;
  description: string;
  input: I;
  handler: (args: z.infer<I>, ctx: ToolContext) => O | Promise<O>;
}

export function defineTool<I extends ZodTypeAny, O>(spec: {
  name: string;
  description: string;
  input: I;
  handler: (args: z.infer<I>, ctx: ToolContext) => O | Promise<O>;
}): Tool<I, O> {
  return spec;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<z.ZodType<any, any, any>, unknown>;
