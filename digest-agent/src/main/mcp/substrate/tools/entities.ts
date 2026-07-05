/**
 * Entity lifecycle + shared identity-handle / case-base tools.
 *
 * Entities are the default first-sight primitive — provisional subjects that
 * haven't earned anchor status. Cheap to create; the mind agent mints them
 * when a new name appears and bumps mention_count on each subsequent sighting.
 * Promotion to anchor happens through the dedicated `promote_entity` tool.
 *
 * `update_identity_handles` and `cite` are node-scoped (anchor OR entity),
 * routed at the tool boundary by reading `nodes.kind`.
 */

import { z } from 'zod';
import { defineTool } from '../tool.js';
import { makeNodesRepo } from '../../../db/nodes.js';
import { makeAnchorsRepo } from '../../../db/anchors.js';
import { makeEntitiesRepo } from '../../../db/entities.js';
import { makeCaseBaseRepo } from '../../../db/caseBase.js';
import type { AnchorId, EntityId, NodeId, SourceId } from '@shared/types/ids.js';
import { slugify, genId } from './_ids.js';

const layerSchema = z.enum(['slow', 'mid', 'fast']);
const idSchema = z.string().min(1).max(128).regex(/^_?[a-z][\w-]*$/i, 'id must match /^_?[a-z][\\w-]*$/i');

// ─── create_entity ─────────────────────────────────────────────────────────

export const createEntity = defineTool({
  name: 'create_entity',
  description:
    "Mint an entity for a noticed-but-not-yet-committed subject. Server slugifies `display_name` into the id. Cheap — the dominant first-sight primitive; reach for `create_anchor` only on high first-sight conviction. Sets mention_count=1, last_seen=now. Fails on id collision.",
  input: z
    .object({
      display_name: z.string().min(1).max(256),
      id: idSchema.optional(),
      kind_hint: z.string().min(1).max(64).default('subject'),
      identity_handles: z.array(z.string()).default([]),
      notes: z.string().max(8000).optional(),
    })
    .strict(),
  handler: (args, ctx) => {
    const nodes = makeNodesRepo(ctx.db);
    const entities = makeEntitiesRepo(ctx.db);

    const id = args.id ?? slugify(args.display_name);
    const existing = nodes.getNodeKind(id);
    if (existing !== null) {
      throw new Error(
        `id collision: "${id}" already exists as ${existing}. Pass an explicit \`id\` to disambiguate, or update the existing row.`,
      );
    }

    const now = ctx.now();
    const tx = ctx.db.transaction(() => {
      nodes.insertNode(id, 'entity', now);
      entities.createEntity({
        id,
        kind: args.kind_hint,
        identity_handles: args.identity_handles,
        ...(args.notes ? { notes: args.notes } : {}),
        first_seen: now,
      });
    });
    tx();

    return { id };
  },
});

// ─── bump_entity ───────────────────────────────────────────────────────────

export const bumpEntity = defineTool({
  name: 'bump_entity',
  description:
    "Record another sighting of this entity: mention_count++ and last_seen=now. The dominant pattern in step 1 of the mind loop — every event that touches a known entity calls this. Returns the new mention_count and last_seen.",
  input: z.object({ id: idSchema }).strict(),
  handler: (args, ctx) => {
    const entities = makeEntitiesRepo(ctx.db);
    const existing = entities.readEntity(args.id as EntityId);
    if (!existing) throw new Error(`entity not found: ${args.id}`);
    const now = ctx.now();
    entities.bumpMentionCount(args.id as EntityId, now);
    const after = entities.readEntity(args.id as EntityId);
    return {
      id: args.id,
      mention_count: after!.mention_count,
      last_seen: after!.last_seen,
    };
  },
});

// ─── update_entity ─────────────────────────────────────────────────────────

export const updateEntity = defineTool({
  name: 'update_entity',
  description:
    "Update an entity's `notes` and/or `kind_hint`. Identity handles have their own tool; mention counters are bumped via `bump_entity`. Pass only the fields you want to change.",
  input: z
    .object({
      id: idSchema,
      kind_hint: z.string().min(1).max(64).optional(),
      notes: z.string().max(8000).optional(),
    })
    .strict()
    .refine((v) => v.kind_hint !== undefined || v.notes !== undefined, {
      message: 'at least one of kind_hint / notes must be provided',
    }),
  handler: (args, ctx) => {
    const entities = makeEntitiesRepo(ctx.db);
    if (!entities.readEntity(args.id as EntityId)) {
      throw new Error(`entity not found: ${args.id}`);
    }
    entities.updateEntity(args.id as EntityId, {
      ...(args.kind_hint !== undefined ? { kind_hint: args.kind_hint } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });
    return { id: args.id };
  },
});

// ─── delete_entity ─────────────────────────────────────────────────────────

export const deleteEntity = defineTool({
  name: 'delete_entity',
  description:
    "Retire an entity — cascades to its relationships and case_base via ON DELETE CASCADE on nodes. Use for stale / wrong / peripheral entities. Most entities, most invocations: leave alone — review is event-driven.",
  input: z.object({ id: idSchema }).strict(),
  handler: (args, ctx) => {
    const entities = makeEntitiesRepo(ctx.db);
    if (!entities.readEntity(args.id as EntityId)) {
      throw new Error(`entity not found: ${args.id}`);
    }
    entities.deleteEntity(args.id as EntityId);
    return { ok: true as const, id: args.id };
  },
});

// ─── update_identity_handles (shared anchor + entity) ──────────────────────

export const updateIdentityHandles = defineTool({
  name: 'update_identity_handles',
  description:
    "Add and/or remove identity handles on an anchor or entity (auto-routed by the node's kind). Handles are emails, names, aliases — anything the agent uses to recognize a subject across events. Atomic add+remove on the JSON array; duplicates collapsed. Returns the new handle list.",
  input: z
    .object({
      node_id: idSchema,
      add: z.array(z.string().min(1)).default([]),
      remove: z.array(z.string().min(1)).default([]),
    })
    .strict()
    .refine((v) => v.add.length > 0 || v.remove.length > 0, {
      message: 'at least one of add / remove must be non-empty',
    }),
  handler: (args, ctx) => {
    const nodes = makeNodesRepo(ctx.db);
    const kind = nodes.getNodeKind(args.node_id);
    if (kind === null) throw new Error(`node not found: ${args.node_id}`);

    const anchors = makeAnchorsRepo(ctx.db);
    const entities = makeEntitiesRepo(ctx.db);

    const tx = ctx.db.transaction(() => {
      const current =
        kind === 'anchor'
          ? anchors.readIdentityHandles(args.node_id as AnchorId)
          : entities.readIdentityHandles(args.node_id as EntityId);
      const removeSet = new Set(args.remove);
      const next = Array.from(
        new Set([...(current ?? []).filter((h) => !removeSet.has(h)), ...args.add]),
      );
      if (kind === 'anchor') {
        anchors.setIdentityHandles(args.node_id as AnchorId, next);
      } else {
        entities.setIdentityHandles(args.node_id as EntityId, next);
      }
      return next;
    });
    const handles = tx() as string[];

    return { id: args.node_id, handles };
  },
});

// ─── cite (standalone case_base entry) ─────────────────────────────────────

export const cite = defineTool({
  name: 'cite',
  description:
    "Add a single case_base citation to a node, independent of a layer-content change. The dominant path is `update_anchor_layer` (which writes content + citations atomically); reach for `cite` only when adding evidence without changing the layer text — e.g. a corroborating message for an existing claim. For an entity, omit `layer` (entity case_base is flat).",
  input: z
    .object({
      node_id: idSchema,
      layer: layerSchema.optional(),
      source_id: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  handler: (args, ctx) => {
    const nodes = makeNodesRepo(ctx.db);
    const kind = nodes.getNodeKind(args.node_id);
    if (kind === null) throw new Error(`node not found: ${args.node_id}`);
    if (kind === 'entity' && args.layer !== undefined) {
      throw new Error('entity case_base entries do not carry a layer; omit `layer`.');
    }

    const caseBase = makeCaseBaseRepo(ctx.db);
    const id = genId('cb');
    caseBase.addEntry({
      id,
      node_id: args.node_id as NodeId,
      layer: args.layer ?? null,
      source_id: args.source_id as SourceId,
      date: args.date ?? ctx.now().slice(0, 10),
      ...(args.note ? { note: args.note } : {}),
    });
    return { id };
  },
});

// ─── exports ───────────────────────────────────────────────────────────────

export const entityTools = {
  [createEntity.name]: createEntity,
  [bumpEntity.name]: bumpEntity,
  [updateEntity.name]: updateEntity,
  [deleteEntity.name]: deleteEntity,
  [updateIdentityHandles.name]: updateIdentityHandles,
  [cite.name]: cite,
};
