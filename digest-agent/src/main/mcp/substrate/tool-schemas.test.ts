/**
 * Regression test: every registered tool for every role surfaces cleanly
 * through MCP `tools/list`.
 *
 * The MCP SDK's `ListToolsResultSchema` validates every tool's `inputSchema`
 * against the spec — including the rule that `inputSchema.type === "object"`
 * at the root. A top-level z.discriminatedUnion / z.union / z.array slips
 * past TypeScript and runtime zod parsing but fails this check, which
 * silently nukes the entire tools/list response (Claude Code then sees zero
 * tools from the substrate server).
 *
 * This test catches the whole class of bug at unit-test speed — no
 * subprocess, no MCP transport.
 */

import { describe, it, expect } from 'vitest';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { CATALOG, toolsForRole, type SubstrateRole } from './catalog.js';
import { toolToMcp } from './server.js';
import type { AnyTool } from './tool.js';

const roles: SubstrateRole[] = ['mind', 'diary', 'cold-start'];

describe('substrate MCP tool schemas', () => {
  for (const role of roles) {
    it(`role=${role}: every tool serializes to a valid MCP inputSchema`, () => {
      const tools = toolsForRole(role);
      const list = Object.values(tools).map(toolToMcp);

      // Sanity: catalog and result line up.
      expect(list.map((t) => t.name).sort()).toEqual([...CATALOG[role]].sort());

      // Validate against the official MCP schema. This is what Claude Code's
      // MCP client uses on the receiving end; if this throws, tools/list
      // would have failed in production.
      const parsed = ListToolsResultSchema.parse({ tools: list });
      expect(parsed.tools).toHaveLength(list.length);

      // Belt-and-braces: every inputSchema must be a JSON object with
      // type === 'object' at the root. The MCP spec requires it and our
      // toolToMcp guard enforces it, but assert it here too so a regression
      // in either layer fails this test loudly.
      for (const t of list) {
        const schema = t.inputSchema as Record<string, unknown>;
        expect(
          schema['type'],
          `tool ${t.name} inputSchema.type must be "object"`,
        ).toBe('object');
      }
    });
  }

  it('toolToMcp throws on a tool with a non-object top-level schema', async () => {
    const { z } = await import('zod');
    const { defineTool } = await import('./tool.js');
    const bad = defineTool({
      name: 'bad_union_tool',
      description: 'reproduces the precision-tools bug',
      input: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), id: z.string() }).strict(),
        z.object({ kind: z.literal('b'), id: z.string() }).strict(),
      ]),
      handler: () => ({}),
    });
    // The Tool<I,O> generic is invariant in I (handler signature uses
    // z.infer<I>), so a discriminated-union tool isn't structurally a
    // sub-type of AnyTool — cast through unknown to feed it to toolToMcp.
    expect(() => toolToMcp(bad as unknown as AnyTool)).toThrow(
      /non-object top-level inputSchema/,
    );
  });
});
