/**
 * Profile watcher.
 *
 * Watches `~/digest/profile.md` for content changes. Debounces (500ms) so
 * editors that save in two strokes don't double-fire. On settled change,
 * emits `profile.changed { mtime, path }` on the bus — the cold-start
 * dispatcher (Phase 8) re-seeds the principal-anchor in response.
 *
 * Architecture: design/08-runtime.md § "Subsystem 5: profile watcher".
 */

import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { Bus } from '../bus.js';
import type { AppConfig } from '@shared/types/config.js';

const DEBOUNCE_MS = 500;

export interface ProfileWatcher {
  start(): void;
  stop(): void;
}

export interface ProfileWatcherOptions {
  /** Override the debounce window for tests. */
  debounceMs?: number;
}

export function createProfileWatcher(
  config: AppConfig,
  bus: Bus,
  opts: ProfileWatcherOptions = {},
): ProfileWatcher {
  const profilePath = join(config.digest_dir, 'profile.md');
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;

  let watcher: FSWatcher | null = null;
  let pending: NodeJS.Timeout | null = null;
  let lastMtime = '';

  function schedule(): void {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      // Editors that atomic-save (write temp, rename) briefly leave the file
      // missing. Skip; the rename completes the dir-watch fires again.
      if (!existsSync(profilePath)) return;
      const stat = statSync(profilePath);
      const mtime = stat.mtime.toISOString();
      if (mtime === lastMtime) return;
      lastMtime = mtime;
      void bus.emit('profile.changed', { mtime, path: profilePath });
    }, debounceMs);
  }

  return {
    start() {
      // Seed lastMtime if the file already exists, so we don't fire on the
      // first watch event for a pre-existing file. If it doesn't exist yet,
      // the first appearance fires naturally (lastMtime stays null).
      if (existsSync(profilePath)) {
        const stat = statSync(profilePath);
        lastMtime = stat.mtime.toISOString();
      }

      // Always watch the directory, never the file directly. This is the
      // robust pattern for editors that save via temp-file + rename (vim,
      // Sublime, VSCode with atomic-save). Watching the file directly works
      // for the first save but loses the watch when the inode changes on
      // rename; the directory watch survives.
      try {
        watcher = watch(config.digest_dir, (_event, filename) => {
          if (filename === 'profile.md') schedule();
        });
      } catch (err) {
        console.error(
          '[profile-watcher] dir watch failed; profile changes will not be detected:',
          err,
        );
      }
    },

    stop() {
      if (pending) {
        clearTimeout(pending);
        pending = null;
      }
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
  };
}
