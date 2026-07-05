/**
 * Seed agent prompts and playbook sections into the `prompts` table at boot.
 *
 * Source of truth is the bundled `prompts/` directory on disk. Per-principal
 * overrides (files dropped in <digest_dir>/) win: if `<digest_dir>/mind-agent.md`
 * exists it is stored as source='override' and its content is what agents read.
 *
 * Idempotent: every boot upserts title + content, so editing a file and
 * restarting is enough to update it.
 *
 * Two kinds of prompts are seeded:
 *   'agent'    — root-level .md files (disposition, mind-agent, diary-agent, …)
 *   'playbook' — everything under prompts/playbook/**\/*.md
 *
 * prompts/seed-plays/ is explicitly excluded — those go into the `plays` table.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';

function bundledPromptsDir(): string {
  const devPath = join(process.cwd(), 'prompts');
  if (existsSync(devPath)) return devPath;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../prompts');
}

/** Walk a directory recursively, yielding relative paths to .md files. */
function walkMd(root: string, prefix = ''): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const full = join(root, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    try {
      if (statSync(full).isDirectory()) {
        out.push(...walkMd(full, rel));
      } else if (entry.endsWith('.md')) {
        out.push(rel);
      }
    } catch {
      // Skip unreadable entries.
    }
  }
  return out;
}

function extractTitle(content: string, fallback: string): string {
  const m = /^#\s+(.+)$/m.exec(content);
  return m ? m[1]!.trim() : fallback;
}

/**
 * Upsert all bundled prompts into the DB.
 * Returns the number of rows upserted.
 */
export function seedPrompts(db: Db, digestDir: string, now: string = new Date().toISOString()): number {
  const bundled = bundledPromptsDir();
  if (!existsSync(bundled)) {
    throw new Error(`bundled prompts directory not found: ${bundled}`);
  }

  const upsert = db.prepare(`
    INSERT INTO prompts (name, kind, title, content, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      title      = excluded.title,
      content    = excluded.content,
      source     = excluded.source,
      updated_at = excluded.updated_at
  `);

  let count = 0;

  // ── Agent prompts (root-level .md, excluding seed-plays/ and playbook/) ───
  for (const file of readdirSync(bundled).sort()) {
    if (!file.endsWith('.md')) continue;
    const name = file.replace(/\.md$/, '');
    const bundledContent = readFileSync(join(bundled, file), 'utf-8');

    // Check for per-principal override in digestDir.
    const overridePath = join(digestDir, file);
    const content = existsSync(overridePath) ? readFileSync(overridePath, 'utf-8') : bundledContent;
    const source = existsSync(overridePath) ? 'override' : 'bundled';

    upsert.run(name, 'agent', extractTitle(content, name), content, source, now, now);
    count++;
  }

  // ── Playbook sections (prompts/playbook/**/*.md) ───────────────────────────
  const playbookBundledDir = join(bundled, 'playbook');
  for (const relPath of walkMd(playbookBundledDir)) {
    const name = `playbook/${relPath.replace(/\.md$/, '')}`;
    const bundledContent = readFileSync(join(playbookBundledDir, relPath), 'utf-8');

    // Override: <digest_dir>/playbook/<relPath>
    const overridePath = join(digestDir, 'playbook', relPath);
    const content = existsSync(overridePath) ? readFileSync(overridePath, 'utf-8') : bundledContent;
    const source = existsSync(overridePath) ? 'override' : 'bundled';

    const shortName = relPath.replace(/\.md$/, '');
    upsert.run(name, 'playbook', extractTitle(content, shortName), content, source, now, now);
    count++;
  }

  return count;
}
