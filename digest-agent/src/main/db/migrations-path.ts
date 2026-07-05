/**
 * Resolves the path to the migrations directory in both dev and packaged contexts.
 *
 * - In dev, `dist/main/index.js` is run by Electron; migrations live in
 *   `src/main/db/migrations` relative to the project root.
 * - In packaged builds, esbuild bundles the migrations into `dist/main/db/migrations`
 *   via the build step (electron-builder copies them via `files`).
 *
 * For now we resolve relative to the project root in dev; packaging refinement
 * comes in Phase 13.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export function migrationsDir(): string {
  // Try dev path first (running from project root).
  const cwd = process.cwd();
  const devPath = join(cwd, 'src/main/db/migrations');
  if (existsSync(devPath)) return devPath;

  // Fallback: relative to the compiled module.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../src/main/db/migrations');
}
