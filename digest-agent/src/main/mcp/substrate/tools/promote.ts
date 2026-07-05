/**
 * `promote_entity` — atomic entity → anchor promotion.
 *
 * The most fragile operation in the substrate: 4 ordered statements with no
 * DB-level alarm for partial completion (an entity row dangling next to its
 * new anchor row with the same id is structurally valid SQLite — the FKs
 * route through `nodes`). So this MUST be a single tool wrapping the whole
 * dance in one transaction.
 *
 * Steps inside the transaction:
 *   1. Flip `nodes.kind` from 'entity' to 'anchor'.
 *   2. Insert an `anchors` row with the same id (slow layer pre-populated
 *      from the caller's evidence-derived content + precision).
 *   3. Delete the matching `entities` row.
 *   4. Re-layer existing entity case_base entries onto the slow layer (they
 *      had layer=NULL while the node was an entity).
 *   5. Add the caller's `source_ids` as fresh case_base citations on the
 *      slow layer.
 *
 * Relationships and reminder_anchor_refs FK against `nodes(id)`, so they
 * keep resolving across the flip — no need to migrate them.
 *
 * Returns the (unchanged) id as `anchor_id` plus the count of citations
 * added vs. re-layered.
 */

import { z } from 'zod';
import { defineTool } from '../tool.js';
import { makeNodesRepo } from '../../../db/nodes.js';
import { makeAnchorsRepo } from '../../../db/anchors.js';
import { makeEntitiesRepo } from '../../../db/entities.js';
import { makeCaseBaseRepo } from '../../../db/caseBase.js';
import { PRECISION_MIN, PRECISION_MAX } from '@shared/types/precision.js';
import type { AnchorId, EntityId, NodeId, SourceId } from '@shared/types/ids.js';
import { genId } from './_ids.js';

const idSchema = z.string().min(1).max(128).regex(/^_?[a-z][\w-]*$/i);
const precisionSchema = z.number().min(PRECISION_MIN).max(PRECISION_MAX);

export const promoteEntity = defineTool({
  name: 'promote_entity',
  description:
    "Atomically promote an entity to an anchor. The same id is preserved, so existing relationships and reminder_anchor_refs keep resolving. The caller supplies a `slow_content` + `slow_precision` (typically 0.50-0.65 — the entity's notes were never claim-tested individually) and `source_ids` to cite. The entity's existing case_base entries (layer=NULL) are re-layered onto the new anchor's slow layer. Optional `kind` overrides the entity's kind_hint; `display_name` likewise.",
  input: z
    .object({
      id: idSchema,
      kind: z.string().min(1).max(64).optional(),
      display_name: z.string().min(1).max(256).optional(),
      slow_content: z.string().min(1).max(20000),
      slow_precision: precisionSchema,
      source_ids: z.array(z.string().min(1)).min(1, 'source_ids must include at least one citation'),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
        .optional(),
    })
    .strict(),
  handler: (args, ctx) => {
    const nodes = makeNodesRepo(ctx.db);
    const entities = makeEntitiesRepo(ctx.db);
    const anchors = makeAnchorsRepo(ctx.db);
    const caseBase = makeCaseBaseRepo(ctx.db);

    const kind = nodes.getNodeKind(args.id);
    if (kind === null) throw new Error(`node not found: ${args.id}`);
    if (kind !== 'entity') throw new Error(`not an entity: ${args.id} is a ${kind}`);

    const entity = entities.readEntity(args.id as EntityId);
    if (!entity) throw new Error(`entity row missing: ${args.id}`);

    const date = args.date ?? ctx.now().slice(0, 10);
    const now = ctx.now();

    const tx = ctx.db.transaction(() => {
      // 1. Flip node kind.
      nodes.setNodeKind(args.id, 'anchor');

      // 2. Insert the anchor row with the agent's composed slow layer.
      //    Reuse identity_handles + display_name + notes from the entity unless
      //    the caller overrides them.
      const handles = JSON.parse(entity.identity_handles) as string[];
      anchors.createAnchor({
        id: args.id,
        kind: args.kind ?? entity.kind_hint ?? 'subject',
        ...(args.display_name ? { display_name: args.display_name } : {}),
        identity_handles: handles,
        slow: { content: args.slow_content, precision: args.slow_precision },
        ...(entity.notes ? { notes: entity.notes } : {}),
        last_bumped: now,
      });

      // 3. Drop the entity row.
      ctx.db.prepare('DELETE FROM entities WHERE id = ?').run(args.id);

      // 4. Re-layer existing case_base (entity-attached, layer=NULL → slow).
      const reLayered = ctx.db
        .prepare(
          "UPDATE case_base_entries SET layer = 'slow' WHERE node_id = ? AND layer IS NULL",
        )
        .run(args.id) as { changes: number };

      // 5. Add fresh citations for the caller's sources.
      let added = 0;
      for (const source_id of args.source_ids) {
        caseBase.addEntry({
          id: genId('cb'),
          node_id: args.id as NodeId,
          layer: 'slow',
          source_id: source_id as SourceId,
          date,
        });
        added += 1;
      }

      return { re_layered: reLayered.changes, added };
    });

    const counts = tx() as { re_layered: number; added: number };
    return {
      anchor_id: args.id as AnchorId,
      cites_re_layered: counts.re_layered,
      cites_added: counts.added,
    };
  },
});

export const promoteTools = {
  [promoteEntity.name]: promoteEntity,
};
