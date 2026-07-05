/**
 * Seed house plays into the `plays` table at boot.
 *
 * All house plays live as bundled markdown under `prompts/seed-plays/` and are
 * upserted into the `plays` table so every agent reads plays from the same SQL
 * surface. Filename convention drives the DB name:
 *
 *   `{prefix}-{slug}.md`  →  `{prefix}:{slug}`
 *
 * Reserved name prefixes:
 *   `howto:`     — derivation guides for cold-start (teach the play-authoring move)
 *   `reasoning:` — inner-mode reasoning moves (mind agent)
 *   `triage:`    — worked triage traces (diary agent)
 *
 * Persona plays (no prefix, e.g. `investor-weekly-update`) are written by
 * cold-start at runtime and are never seeded here.
 *
 * Idempotent: re-running refreshes title/content but preserves the row.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';

/** Reserved name prefix for cold-start derivation guides. */
export const HOWTO_PLAY_PREFIX = 'howto:';
/** Reserved name prefix for inner-mode reasoning-move plays. */
export const REASONING_PLAY_PREFIX = 'reasoning:';
/** Reserved name prefix for triage worked-example plays. */
export const TRIAGE_PLAY_PREFIX = 'triage:';

/** All reserved prefixes — persona plays must not use any of these. */
export const HOUSE_PLAY_PREFIXES = [HOWTO_PLAY_PREFIX, REASONING_PLAY_PREFIX, TRIAGE_PLAY_PREFIX];

function seedPlaysDir(): string {
  const cwd = process.cwd();
  const devPath = join(cwd, 'prompts/seed-plays');
  if (existsSync(devPath)) return devPath;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../prompts/seed-plays');
}

/**
 * Derive the DB play name from the seed filename.
 * Converts `{prefix}-{slug}.md` → `{prefix}:{slug}`.
 * Throws if the filename doesn't follow the convention (no `-` separator).
 */
export function seedFileToPlayName(filename: string): string {
  const base = filename.replace(/\.md$/, '');
  const dash = base.indexOf('-');
  if (dash === -1) {
    throw new Error(
      `seed-play filename "${filename}" must follow the "{prefix}-{slug}.md" convention`,
    );
  }
  const prefix = base.slice(0, dash);
  const slug = base.slice(dash + 1);
  return `${prefix}:${slug}`;
}

/**
 * Upsert every `prompts/seed-plays/*.md` file into the `plays` table.
 * Returns the number of files seeded. Throws if the directory is missing
 * (a real packaging/path bug we want surfaced, not silently skipped).
 */
export function seedHousePlays(db: Db, now: string = new Date().toISOString()): number {
  const dir = seedPlaysDir();
  if (!existsSync(dir)) {
    throw new Error(`seed-plays directory not found at ${dir}`);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const upsert = db.prepare(
    `INSERT INTO plays (name, title, content, derived_from, created_at)
     VALUES (?, ?, ?, '__house_seed__', ?)
     ON CONFLICT(name) DO UPDATE SET title = excluded.title, content = excluded.content`,
  );

  let seeded = 0;
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8');
    const titleMatch = /^#\s+(.+)$/m.exec(raw);
    const title = titleMatch ? titleMatch[1]!.trim() : file.replace(/\.md$/, '');
    const name = seedFileToPlayName(file);
    upsert.run(name, title, raw, now);
    seeded++;
  }
  return seeded;
}
