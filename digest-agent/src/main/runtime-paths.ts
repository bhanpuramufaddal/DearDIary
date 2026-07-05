/**
 * Runtime path resolution for the app bundle.
 *
 * In dev (`npm run dev`), `app.getAppPath()` returns `<repo>` so the dist/
 * paths land at `<repo>/dist/...`. In a packaged Electron build, the same
 * call returns the path inside the .app bundle's resources, so the same
 * `join(appPath, 'dist', …)` resolves correctly.
 *
 * Electron is imported via ESM at the top of the module. The bundle marks
 * `electron` as external (see esbuild.config.mjs) so it's resolved at runtime
 * by the Electron host. Tests don't go through `boot()` and inject explicit
 * paths via dispatcher `opts.substrateServerPath`; importing this module from
 * a non-Electron process (vitest) will fail at module-load — that's the
 * intended boundary, not a bug.
 */

import { app } from 'electron';
import { join } from 'node:path';

let cachedAppPath: string | null = null;

function appPath(): string {
  if (cachedAppPath) return cachedAppPath;
  if (typeof app?.getAppPath !== 'function') {
    throw new Error(
      'runtime-paths: electron.app.getAppPath is not available. ' +
        'This module is only callable from the Electron main process; ' +
        'tests must inject explicit paths via dispatcher opts.',
    );
  }
  cachedAppPath = app.getAppPath();
  return cachedAppPath;
}

export function substrateServerPath(): string {
  return join(appPath(), 'dist', 'main', 'mcp', 'substrate', 'server.js');
}

export function surfaceServerPath(): string {
  return join(appPath(), 'dist', 'main', 'mcp', 'surface', 'server.js');
}

export function personaEmailServerPath(): string {
  return join(appPath(), 'dist', 'main', 'mcp', 'personaEmail', 'server.js');
}

export function personaCalendarServerPath(): string {
  return join(appPath(), 'dist', 'main', 'mcp', 'personaCalendar', 'server.js');
}

export function personaNotesServerPath(): string {
  return join(appPath(), 'dist', 'main', 'mcp', 'personaNotes', 'server.js');
}

/** Directory holding bundled agent prompts (disposition.md, mind-agent.md, …). */
export function bundledPromptsDir(): string {
  return join(appPath(), 'prompts');
}
