/**
 * Plays tool — persona-custom precedent library writes (cold-start scope).
 *
 * The `plays` table holds house seeds + persona plays, differentiated by
 * name prefix:
 *  - `howto:`     — derivation guides (teach cold-start the authoring move)
 *  - `reasoning:` — inner-mode reasoning moves (mind agent on demand)
 *  - `triage:`    — triage worked examples (diary agent)
 *  - *(none)*     — persona plays derived from this principal's history
 *
 * This tool writes the PERSONA flavor only. All reserved prefixes are
 * rejected — cold-start must not overwrite house seeds.
 */

import { z } from 'zod';
import { defineTool } from '../tool.js';
import { makePlaysRepo } from '../../../db/plays.js';
import { HOUSE_PLAY_PREFIXES } from '../../../db/seedPlays.js';

export const createPlay = defineTool({
  name: 'create_play',
  description:
    "Insert (or refresh) a persona play — a precedent derived from the principal's observed history that the diary reads as a few-shot when composing. `name` is the kebab id (e.g. 'investor-weekly-update'); MUST NOT start with a reserved prefix (`howto:`, `reasoning:`, `triage:`) — those are house plays seeded at boot. `derived_from` is the list of source_ids the play generalizes from. Upsert: re-running with the same name refreshes title/content without churning created_at.",
  input: z
    .object({
      name: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-z][a-z0-9-]*(:[\w-]+)?$/, 'name must be kebab-case')
        .refine((n) => !HOUSE_PLAY_PREFIXES.some((p) => n.startsWith(p)), {
          message: `reserved prefix — house play prefixes (${HOUSE_PLAY_PREFIXES.join(', ')}) are seeded at boot and cannot be written by agents`,
        }),
      title: z.string().min(1).max(256),
      content: z.string().min(1).max(20000),
      derived_from: z.array(z.string().min(1)).default([]),
    })
    .strict(),
  handler: (args, ctx) => {
    const plays = makePlaysRepo(ctx.db);
    plays.upsertPlay({
      name: args.name,
      title: args.title,
      content: args.content,
      derived_from: args.derived_from,
      created_at: ctx.now(),
    });
    return { name: args.name };
  },
});

export const playTools = {
  [createPlay.name]: createPlay,
};
