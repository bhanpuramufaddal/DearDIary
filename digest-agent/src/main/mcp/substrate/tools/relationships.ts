/**
 * Relationship tools — directed edges from a subject node to a target anchor.
 *
 * Decomposed REST-style: minimal `create_relationship` returns an id;
 * `update_relationship_layer` writes claim + optional initial precision;
 * precision movement after initialization goes through the nudge tools.
 *
 * Target-must-be-anchor is pre-checked at the tool boundary (clearer error)
 * before the SQL trigger fires.
 *
 * Note: relationship layer evidence is not separately tracked in case_base —
 * the connected anchors' case_base implicitly grounds it. Hence no
 * `source_ids` param on `update_relationship_layer` (unlike the anchor
 * variant).
 */

import { z } from 'zod';
import { defineTool } from '../tool.js';
import { makeNodesRepo } from '../../../db/nodes.js';
import { makeRelationshipsRepo } from '../../../db/relationships.js';
import { PRECISION_MIN, PRECISION_MAX } from '@shared/types/precision.js';
import type { AnchorId, NodeId, RelationshipId } from '@shared/types/ids.js';
import { genId } from './_ids.js';

const layerSchema = z.enum(['slow', 'mid', 'fast']);
const precisionSchema = z.number().min(PRECISION_MIN).max(PRECISION_MAX);
const idSchema = z.string().min(1).max(128).regex(/^_?[a-z][\w-]*$/i, 'id must match /^_?[a-z][\\w-]*$/i');
const relIdSchema = z.string().min(1).max(128).regex(/^rel_[\w-]+$/, 'relationship id must match /^rel_[\\w-]+$/');

// ─── create_relationship ───────────────────────────────────────────────────

export const createRelationship = defineTool({
  name: 'create_relationship',
  description:
    "Create a directed relationship from a subject node (anchor or entity) to a TARGET ANCHOR. The target must already be an anchor — pre-checked here (clearer error than the SQL trigger). Server-generated id (`rel_…`). Fails on duplicate (subject_id, target_id) pair. Layer claims arrive via `update_relationship_layer`.",
  input: z
    .object({
      subject_id: idSchema,
      target_id: idSchema,
    })
    .strict(),
  handler: (args, ctx) => {
    const nodes = makeNodesRepo(ctx.db);
    const subjectKind = nodes.getNodeKind(args.subject_id);
    if (subjectKind === null) throw new Error(`subject node not found: ${args.subject_id}`);
    const targetKind = nodes.getNodeKind(args.target_id);
    if (targetKind === null) throw new Error(`target node not found: ${args.target_id}`);
    if (targetKind !== 'anchor') {
      throw new Error(
        `target must be an anchor: ${args.target_id} is a ${targetKind}. Promote the entity first via promote_entity.`,
      );
    }

    const relationships = makeRelationshipsRepo(ctx.db);
    const id = genId('rel');
    relationships.createRelationshipMinimal({
      id,
      subject_id: args.subject_id as NodeId,
      target_id: args.target_id as AnchorId,
    });
    return { id };
  },
});

// ─── update_relationship_layer ─────────────────────────────────────────────

export const updateRelationshipLayer = defineTool({
  name: 'update_relationship_layer',
  description:
    "Write claim text for one of a relationship's three layers (slow / mid / fast). `precision` is allowed only on the layer's first write (when current precision is NULL); after that, use `support_relationship_precision` / `contradict_relationship_precision` to nudge. Returns the layer's current precision after the write.",
  input: z
    .object({
      id: relIdSchema,
      layer: layerSchema,
      claim: z.string().min(1).max(8000),
      precision: precisionSchema.optional(),
    })
    .strict(),
  handler: (args, ctx) => {
    const relationships = makeRelationshipsRepo(ctx.db);
    const existing = relationships.readRelationship(args.id as RelationshipId);
    if (!existing) throw new Error(`relationship not found: ${args.id}`);

    const currentPrecision = relationships.readLayerPrecision(args.id as RelationshipId, args.layer);
    if (args.precision !== undefined && currentPrecision !== null) {
      throw new Error(
        `precision is already set on ${args.id}/${args.layer} (current=${currentPrecision}); use support_relationship_precision / contradict_relationship_precision to nudge.`,
      );
    }

    if (args.precision !== undefined) {
      relationships.setLayerClaim(args.id as RelationshipId, args.layer, args.claim, args.precision);
    } else {
      relationships.setLayerClaim(args.id as RelationshipId, args.layer, args.claim);
    }

    const newPrecision = relationships.readLayerPrecision(args.id as RelationshipId, args.layer);
    return { id: args.id, layer: args.layer, precision: newPrecision };
  },
});

// ─── delete_relationship ───────────────────────────────────────────────────

export const deleteRelationship = defineTool({
  name: 'delete_relationship',
  description:
    "Delete a relationship row. Returns { ok: true } on success or throws if the relationship doesn't exist.",
  input: z.object({ id: relIdSchema }).strict(),
  handler: (args, ctx) => {
    const relationships = makeRelationshipsRepo(ctx.db);
    if (!relationships.readRelationship(args.id as RelationshipId)) {
      throw new Error(`relationship not found: ${args.id}`);
    }
    relationships.deleteRelationship(args.id as RelationshipId);
    return { ok: true as const, id: args.id };
  },
});

export const relationshipTools = {
  [createRelationship.name]: createRelationship,
  [updateRelationshipLayer.name]: updateRelationshipLayer,
  [deleteRelationship.name]: deleteRelationship,
};
