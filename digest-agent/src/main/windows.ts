/**
 * Window manager for the renderer surfaces.
 *
 * Four window kinds: diary, inspector, settings, onboarding. Each is a
 * singleton — opening twice focuses the existing window instead of creating
 * a duplicate.
 *
 * The diary is special: it ships frameless, is pre-created hidden at boot
 * (so a tray click is instant), is toggled show/hide (no close button to
 * dismiss it), and hides instead of destroying on close. The others keep
 * standard chrome and the destroy-on-close lifecycle.
 *
 * The manager also fan-outs bus events to every open window — even hidden
 * ones — so a pre-rendered diary stays current while it waits to be shown.
 *
 * Architecture: design/11-backend-architecture.md § "Subsystem 8: renderer".
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { Bus } from './bus.js';
import type { BusKind, PayloadOf } from '@shared/types/events.js';

export type WindowKind = 'diary' | 'inspector' | 'settings' | 'onboarding';

export interface WindowManager {
  open(kind: WindowKind): BrowserWindow;
  toggle(kind: WindowKind): void;
  get(kind: WindowKind): BrowserWindow | null;
  closeAll(): void;
  /** Broadcast a bus event to every open window. */
  broadcast<K extends BusKind>(kind: K, payload: PayloadOf<K>): void;
}

interface WindowSpec {
  width: number;
  height: number;
  title: string;
  /** Subdirectory under src/renderer/, matches the bundle output. */
  bundle: string;
  /** Default true. `false` removes the chrome (no titlebar, no close button). */
  frame?: boolean;
  /** Default false (destroy on close). `true` makes close hide the window. */
  hideOnClose?: boolean;
  /** Default true. `false` skips the ready-to-show auto-show — window loads hidden. */
  autoShowOnReady?: boolean;
  /** Default false. `true` keeps the window above other windows. */
  alwaysOnTop?: boolean;
}

const SPECS: Record<WindowKind, WindowSpec> = {
  diary: {
    width: 760,
    height: 980,
    title: "Today's Diary",
    bundle: 'diary',
    frame: false,
    hideOnClose: true,
    autoShowOnReady: false,
    alwaysOnTop: true,
  },
  inspector: { width: 1100, height: 760, title: 'Inspector', bundle: 'inspector' },
  settings: { width: 760, height: 640, title: 'Settings', bundle: 'settings' },
  onboarding: { width: 720, height: 620, title: 'Welcome to Digest', bundle: 'onboarding' },
};

/**
 * Set by `index.ts` in `before-quit` *before* awaiting shutdown so the
 * `hideOnClose` branch falls through and lets the app actually exit.
 */
let appQuitting = false;
export function setAppQuitting(v: boolean): void {
  appQuitting = v;
}

export function createWindowManager(bus: Bus, now: () => Date): WindowManager {
  const windows = new Map<WindowKind, BrowserWindow>();

  function rendererRoot(): string {
    // In dev, esbuild output goes to dist/renderer; in packaged builds the
    // same relative layout is preserved next to the asar.
    const appPath = app.getAppPath();
    return join(appPath, 'dist', 'renderer');
  }

  function todayIso(): string {
    return now().toISOString().slice(0, 10);
  }

  function open(kind: WindowKind): BrowserWindow {
    const existing = windows.get(kind);
    if (existing && !existing.isDestroyed()) {
      // If a singleton has been hidden (e.g. the diary), open() makes it
      // visible too — focus() alone wouldn't surface a hidden window.
      if (!existing.isVisible()) existing.show();
      existing.focus();
      return existing;
    }
    const spec = SPECS[kind];
    const win = new BrowserWindow({
      width: spec.width,
      height: spec.height,
      title: spec.title,
      backgroundColor: '#faf7ef', // paper tone; matches frame.css --paper
      show: false,
      frame: spec.frame ?? true,
      alwaysOnTop: spec.alwaysOnTop ?? false,
      webPreferences: {
        preload: join(rendererRoot(), 'preload.cjs'),
        contextIsolation: true,
        sandbox: false, // need Node in preload for ipcRenderer
        nodeIntegration: false,
      },
    });
    win.once('ready-to-show', () => {
      if (spec.autoShowOnReady !== false) win.show();
    });

    // hideOnClose: a close event (from window.close(), Cmd+W, or the system)
    // hides instead of destroying — UNLESS the app is quitting, in which case
    // we let the default destroy path run so app.exit can return.
    win.on('close', (e) => {
      if (spec.hideOnClose && !appQuitting) {
        e.preventDefault();
        win.hide();
        // Critical: do NOT delete from `windows` — we want to reuse this
        // BrowserWindow on the next toggle.
      }
    });
    // Real destruction (only fires after a successful close, i.e. either
    // hideOnClose=false or appQuitting=true) → drop from the map.
    win.on('closed', () => {
      windows.delete(kind);
    });

    // Esc-to-hide for hideOnClose windows. Main-side capture so the renderer
    // doesn't need its own keyboard handling or IPC plumbing for this.
    if (spec.hideOnClose) {
      win.webContents.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          e.preventDefault();
          win.hide();
        }
      });
    }

    void win.loadFile(join(rendererRoot(), spec.bundle, 'index.html'));
    windows.set(kind, win);
    return win;
  }

  function toggle(kind: WindowKind): void {
    const win = windows.get(kind);
    if (!win || win.isDestroyed()) {
      // Defensive: open() will create+show. (For diary this shouldn't happen
      // post-boot since we pre-create, but possible if the renderer crashed.)
      open(kind);
      return;
    }
    if (win.isVisible()) {
      win.hide();
      return;
    }
    // refresh-on-show: tell the renderer the current day so it can re-paint
    // for today if the rendered date is stale (e.g. ran past midnight).
    win.webContents.send('diary:show', { today: todayIso() });
    win.show();
    if (process.platform === 'darwin') app.focus({ steal: true });
    win.focus();
  }

  // Single '*' subscriber forwards everything to every open window. The
  // renderer-side filter is cheap and keeps the main side simple. Hidden
  // windows still receive events (so the pre-rendered diary stays current).
  bus.on('*', (payload, meta) => {
    for (const win of windows.values()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('digest:event', { kind: meta.kind, payload });
    }
  });

  return {
    open,
    toggle,
    get(kind) {
      const w = windows.get(kind);
      return w && !w.isDestroyed() ? w : null;
    },
    closeAll() {
      for (const win of windows.values()) {
        if (!win.isDestroyed()) win.close();
      }
      windows.clear();
    },
    broadcast(kind, payload) {
      for (const win of windows.values()) {
        if (win.isDestroyed()) continue;
        win.webContents.send('digest:event', { kind, payload });
      }
    },
  };
}
