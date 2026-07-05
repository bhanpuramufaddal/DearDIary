/**
 * Anchor lifecycle tools.
 *
 * REST-style decomposition: an anchor is an aggregate root with sub-resources
 * (layers, identity handles, evidence, edges, predictions). Each sub-resource
 * has its own endpoint. `create_anchor` is the minimal node; layers and
 * evidence arrive via `update_anchor_layer` (atomic: content + case_base in
 * one transaction); precision arithmetic stays in
 * `support_anchor_precision` / `contradict_anchor_precision`.
 *
 * The "every claim is cited" rule is structural here, not prose discipline:
 * `update_anchor_layer` requires `source_ids` non-empty. Ungrounded layer
 * writes are impossible at the type level.
 *
 * Precision discipline: a layer's *initial* precision can be set on the first
 * write (when current precision is NULL). Subsequent changes go through the
 * nudge tools. This prevents the agent from "guessing" new precision values
 * arbitrarily; the formula owns precision movement once initialized.
 */

import { z } from 'zod';
import { defineTool } from '../tool.js';
import { makeNodesRepo } from '../../../db/nodes.js';
import { makeAnchorsRepo } from '../../../db/anchors.js';
import { makeCaseBaseRepo } from '../../../db/caseBase.js';
import { PRECISION_MIN, PRECISION_MAX } from '@shared/types/precision.js';
import type { AnchorId, NodeId, SourceId } from '@shared/types/ids.js';
import { slugify, genId } from './_ids.js';

const layerSchema = z.enum(['slow', 'mid', 'fast']);
const precisionSchema = z.number().min(PRECISION_MIN).max(PRECISION_MAX);
const idSchema = z.string().min(1).max(128).regex(/^_?[a-z][\w-]*$/i, 'id must match /^_?[a-z][\\w-]*$/i');

// ─── create_anchor ─────────────────────────────────────────────────────────

export const createAnchor = defineTool({
  name: 'create_anchor',
  description:
    "Create a new anchor — high-conviction subject. Pass `display_name` and the server slugifies it into the id (e.g. \"Marcus Webb\" → \"marcus_webb\"). Pass an explicit `id` only for reserved ids (today: \"_principal\"). No layers required at creation time — fill them via `update_anchor_layer` as evidence arrives. Inserts nodes + anchors atomically. Fails on id collision with helpful error (suggesting you may want `update_anchor_*` or a disambiguated id).",
  input: z
    .object({
      display_name: z.string().min(1).max(256),
      id: idSchema.optional(),
      kind: z.string().min(1).max(64).default('subject'),
      identity_handles: z.array(z.string()).default([]),
      notes: z.string().max(8000).optional(),
    })
    .strict(),
  handler: (args, ctx) => {
    const nodes = makeNodesRepo(ctx.db);
    const anchors = makeAnchorsRepo(ctx.db);

    const id = args.id ?? slugify(args.display_name);
    const existing = nodes.getNodeKind(id);
    if (existing !== null) {
      throw new Error(
        `id collision: "${id}" already exists as ${existing}. Pass an explicit \`id\` to disambiguate, or update the existing row instead of recreating it.`,
      );
    }

    const now = ctx.now();
    const tx = ctx.db.transaction(() => {
      nodes.insertNode(id, 'anchor', now);
      anchors.createAnchorMinimal({
        id,
        kind: args.kind,
        ...(args.display_name ? { display_name: args.display_name } : {}),
        identity_handles: args.identity_handles,
        ...(args.notes ? { notes: args.notes } : {}),
        last_bumped: now,
      });
    });
    tx();

    return { id };
  },
});

// ─── update_anchor_layer ───────────────────────────────────────────────────

export const updateAnchorLayer = defineTool({
  name: 'update_anchor_layer',
  description:
    "Write content for one of an anchor's three layers (slow / mid / fast) AND insert case_base citations in the same transaction. `source_ids` is required and non-empty — every claim must be cited. `precision` is allowed only on the layer's first write (when current precision is NULL); after that, use `support_anchor_precision` / `contradict_anchor_precision` to nudge. Returns the layer's current precision after the write (NULL only if you wrote initial content without precision — strongly discouraged).",
  input: z
    .object({
      id: idSchema,
      layer: layerSchema,
      content: z.string().min(1).max(20000),
      source_ids: z.array(z.string().min(1)).min(1, 'source_ids must include at least one citation'),
      precision: precisionSchema.optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
        .optional(),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  handler: (args, ctx) => {
    const anchors = makeAnchorsRepo(ctx.db);
    const caseBase = makeCaseBaseRepo(ctx.db);

    const existing = anchors.readAnchor(args.id as AnchorId);
    if (!existing) throw new Error(`anchor not found: ${args.id}`);

    const currentPrecision = anchors.readLayerPrecision(args.id as AnchorId, args.layer);

    // Initial-precision-only rule: precision may be set when current is NULL.
    // Once it has a value, precision movement is the nudge tools' job.
    if (args.precision !== undefined && currentPrecision !== null) {
      throw new Error(
        `precision is already set on ${args.id}/${args.layer} (current=${currentPrecision}); use support_anchor_precision / contradict_anchor_precision to nudge. Drop the \`precision\` arg to update content only.`,
      );
    }

    const date = args.date ?? ctx.now().slice(0, 10);

    const tx = ctx.db.transaction(() => {
      if (args.precision !== undefined) {
        anchors.updateAnchorLayer(args.id as AnchorId, args.layer, args.content, args.precision);
      } else {
        anchors.updateAnchorLayer(args.id as AnchorId, args.layer, args.content);
      }
      for (const source_id of args.source_ids) {
        caseBase.addEntry({
          id: genId('cb'),
          node_id: args.id as NodeId,
          layer: args.layer,
          source_id: source_id as SourceId,
          date,
          ...(args.note ? { note: args.note } : {}),
        });
      }
    });
    tx();

    const newPrecision = anchors.readLayerPrecision(args.id as AnchorId, args.layer);
    return {
      id: args.id,
      layer: args.layer,
      precision: newPrecision,
      cites_added: args.source_ids.length,
    };
  },
});

// ─── update_anchor_meta ────────────────────────────────────────────────────

export const updateAnchorMeta = defineTool({
  name: 'update_anchor_meta',
  description:
    "Update an anchor's non-layer metadata: display_name, kind, or notes. Layers and identity handles have their own tools. Pass only the fields you want to change.",
  input: z
    .object({
      id: idSchema,
      display_name: z.string().min(1).max(256).optional(),
      kind: z.string().min(1).max(64).optional(),
      notes: z.string().max(8000).optional(),
    })
    .strict()
    .refine(
      (v) => v.display_name !== undefined || v.kind !== undefined || v.notes !== undefined,
      { message: 'at least one of display_name / kind / notes must be provided' },
    ),
  handler: (args, ctx) => {
    const anchors = makeAnchorsRepo(ctx.db);
    if (!anchors.readAnchor(args.id as AnchorId)) {
      throw new Error(`anchor not found: ${args.id}`);
    }
    anchors.updateAnchorMeta(args.id as AnchorId, {
      ...(args.display_name !== undefined ? { display_name: args.display_name } : {}),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });
    return { id: args.id };
  },
});

// ─── bump_anchor ───────────────────────────────────────────────────────────

export const bumpAnchor = defineTool({
  name: 'bump_anchor',
  description:
    "Mark an anchor as recently touched — sets `last_bumped` to now. Use when an event activates the anchor but doesn't warrant a layer update. Returns the new last_bumped timestamp.",
  input: z.object({ id: idSchema }).strict(),
  handler: (args, ctx) => {
    const anchors = makeAnchorsRepo(ctx.db);
    if (!anchors.readAnchor(args.id as AnchorId)) {
      throw new Error(`anchor not found: ${args.id}`);
    }
    const now = ctx.now();
    anchors.bumpAnchor(args.id as AnchorId, now);
    return { id: args.id, last_bumped: now };
  },
});

// ─── delete_anchor ─────────────────────────────────────────────────────────

export const deleteAnchor = defineTool({
  name: 'delete_anchor',
  description:
    "Delete an anchor — cascades to its relationships, predictions, case_base entries (via ON DELETE CASCADE on nodes). Rare; prefer keeping anchors with low precision over deleting. Returns { ok: true } on success or throws if the anchor doesn't exist.",
  input: z.object({ id: idSchema }).strict(),
  handler: (args, ctx) => {
    const anchors = makeAnchorsRepo(ctx.db);
    if (!anchors.readAnchor(args.id as AnchorId)) {
      throw new Error(`anchor not found: ${args.id}`);
    }
    anchors.deleteAnchor(args.id as AnchorId);
    return { ok: true as const, id: args.id };
  },
});

// ─── exports ───────────────────────────────────────────────────────────────

export const anchorTools = {
  [createAnchor.name]: createAnchor,
  [updateAnchorLayer.name]: updateAnchorLayer,
  [updateAnchorMeta.name]: updateAnchorMeta,
  [bumpAnchor.name]: bumpAnchor,
  [deleteAnchor.name]: deleteAnchor,
};
