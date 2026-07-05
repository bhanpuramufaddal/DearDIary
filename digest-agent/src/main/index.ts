/**
 * Electron app entry point.
 * Phase 1 scope: boot to a tray icon. Subsystems wire in later phases.
 */

// Load env files into process.env before any other module reads env vars
// (e.g., Langfuse credentials in initLangfuse). Precedence: project-local
// `./.env` wins over the monorepo-level `../.env` (the myrico shared file
// where keys like LANGFUSE_* + ANTHROPIC_API_KEY actually live). Both are
// optional — if neither exists nothing happens.
//
// Native inline loader — using `dotenv` was tempting but esbuild bundles its
// CJS into the ESM output and the dynamic `require('fs')` inside fails at
// runtime with "Dynamic require of fs is not supported". `node:fs` works
// fine in the ESM bundle.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue; // don't override pre-set
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvFile(resolve('.env'));
loadEnvFile(resolve('..', '.env'));
import { app } from 'electron';
import { initTray } from './tray.js';
import { boot, shutdown } from './boot.js';
import { setAppQuitting } from './windows.js';

// Prevent multiple instances of the app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // macOS: keep app alive without a visible window (tray app).
  // Do nothing on window-all-closed — by not calling app.quit(), the app stays alive.
  app.on('window-all-closed', () => {
    /* keep running as a tray app */
  });

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      app.dock?.hide();
    }

    try {
      await boot();
    } catch (err) {
      console.error('[boot] failed:', err);
      app.exit(1);
      return;
    }

    // Tray after boot so its bus subscriptions can attach to a live bus.
    initTray();
  });

  app.on('before-quit', async (e) => {
    e.preventDefault();
    // Sync, before any await: lets hideOnClose windows fall through to destroy
    // during shutdown so app.exit() can return.
    setAppQuitting(true);
    try {
      await shutdown();
    } catch (err) {
      console.error('[shutdown] error:', err);
    } finally {
      app.exit(0);
    }
  });
}
