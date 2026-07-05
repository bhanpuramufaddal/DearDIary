/**
 * ID helpers used inside tool handlers. NOT exposed as tools.
 *
 * Two failure modes these address (both LLM-intrinsic, not engineering hygiene):
 *
 * 1. **Random suffix collisions.** LLMs invent ids like `pred_1`, `cb_xyz`
 *    that collide across invocations or even within one turn. `genId` returns
 *    `${prefix}_${nanoid(8)}` — ~10^14 entropy, collision-free in practice.
 *
 * 2. **Semantic id drift.** "Marcus Webb" → `marcus_webb` one session and
 *    `webb_marcus` another. `slugify` is deterministic: same display name
 *    always yields the same slug. The agent decides whether two display names
 *    refer to the same subject (via case_base + identity_handles); the slug
 *    is just the canonical id once that decision is made.
 */

import { nanoid } from 'nanoid';

/**
 * Generate a server-side random id. Used for relationships, predictions,
 * case_base entries, reminders — anywhere the id is opaque to the agent.
 *
 *   genId('pred')   → 'pred_4ZxKpwQa'
 *   genId()         → '4ZxKpwQa'
 *
 * @param prefix Optional resource prefix joined with `_`.
 * @param length Suffix length (default 8 — ~52 bits of entropy, ample for
 *               substrate's expected lifetime row counts).
 */
export function genId(prefix?: string, length = 8): string {
  const suffix = nanoid(length);
  return prefix ? `${prefix}_${suffix}` : suffix;
}

/**
 * Deterministic display-name → node-id slug.
 *
 * Process:
 *   1. Unicode-normalize (NFKD), strip combining marks (diacritics).
 *   2. Lowercase.
 *   3. Replace runs of non-[a-z0-9_] with a single `_`.
 *   4. Trim leading/trailing `_`.
 *   5. Prepend `_` if the result starts with a digit (schema convention:
 *      ids start with a letter or `_`).
 *   6. Throw on empty result (caller should have rejected before calling).
 *
 * Examples:
 *   "Marcus Webb"        → "marcus_webb"
 *   "André O'Brien"      → "andre_o_brien"
 *   "Q2 Migration"       → "q2_migration"
 *   "  trim me  "        → "trim_me"
 *   "123 Numbers"        → "_123_numbers"
 *
 * Does NOT check the DB for existing rows — caller decides whether a
 * collision is "same subject, reuse the id" or "different subject, pass
 * an explicit disambiguated id".
 */
export function slugify(displayName: string): string {
  // U+0300 to U+036F is the Combining Diacritical Marks block — after NFKD
  // decomposes "é" into "e" + combining acute, this strip leaves the ASCII e.
  const stripped = displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const lower = stripped.toLowerCase();
  const replaced = lower.replace(/[^a-z0-9_]+/g, '_');
  const trimmed = replaced.replace(/^_+|_+$/g, '');
  if (!trimmed) {
    throw new Error(
      `slugify: display_name "${displayName}" produces an empty slug after normalization`,
    );
  }
  return /^[0-9]/.test(trimmed) ? `_${trimmed}` : trimmed;
}
