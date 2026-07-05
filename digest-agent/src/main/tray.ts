/**
 * System tray icon + menu.
 *
 * Phase 12: full menu with tunnel-status indicator, reminders submenu, restart
 * tunnel action. The tray rebuilds its menu on every bus event (cheap, infrequent)
 * so principal-visible state — pending reminders, tunnel up/down — stays current.
 */

import { app, Tray, Menu, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { getBus, getDb, getWindowManager } from './boot.js';

let tray: Tray | null = null;
let tunnelUp = false;
let tunnelUrl: string | undefined;

/** 16×16 transparent PNG — macOS shows the title text we set. */
const TRANSPARENT_PNG_16 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVR4nGNgGAWjYBSMglEwCkbBKBgFAAAFAAEqXgkPAAAAAElFTkSuQmCC',
  'base64',
);

export function initTray(): void {
  const icon = nativeImage.createFromBuffer(TRANSPARENT_PNG_16);
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  setTitle();
  tray.setToolTip('Digest Agent');
  rebuildMenu();

  // Live-update tray state on bus events. initTray runs after boot() in
  // index.ts, so the bus is guaranteed initialized at this point.
  const bus = getBus();
  bus.on('tunnel.up', (p) => {
    tunnelUp = true;
    tunnelUrl = p.public_url;
    setTitle();
    rebuildMenu();
  });
  bus.on('tunnel.down', () => {
    tunnelUp = false;
    tunnelUrl = undefined;
    setTitle();
    rebuildMenu();
  });
  bus.on('reminder.fired', () => rebuildMenu());
  // After any cognition turn, pending reminders may have changed — rebuild.
  bus.on('mind.invocation.done', () => rebuildMenu());
}

function setTitle(): void {
  if (!tray) return;
  tray.setTitle(tunnelUp ? 'Digest' : 'Digest⚠');
}

function rebuildMenu(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildTemplate()));
}

function buildTemplate(): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];

  items.push({
    label: tunnelUp
      ? `Tunnel: up${tunnelUrl ? ` (${truncate(tunnelUrl, 36)})` : ''}`
      : 'Tunnel: down',
    enabled: false,
  });
  items.push({
    label: 'Restart tunnel',
    click: () => {
      restartTunnel().catch((err: unknown) =>
        console.error('[tray] restart tunnel failed:', err),
      );
    },
  });
  items.push({ type: 'separator' });

  items.push({
    label: "Today's diary",
    click: () => {
      try {
        getWindowManager().toggle('diary');
      } catch (err) {
        console.error('[tray] toggle diary failed:', err);
      }
    },
  });
  items.push({
    label: 'Inspector',
    click: () => openWindow('inspector'),
  });
  items.push({
    label: 'Settings',
    click: () => openWindow('settings'),
  });

  // Reminders submenu — live-queried.
  const reminders = listPendingReminders();
  if (reminders.length > 0) {
    items.push({
      label: `Pending reminders (${reminders.length})`,
      submenu: reminders.slice(0, 10).map((r) => ({
        label: `${formatTime(r.fires_at)} · ${truncate(r.context, 48)}`,
        enabled: false,
      })),
    });
  }

  items.push({ type: 'separator' });
  items.push({ label: 'Quit', role: 'quit', click: () => app.quit() });
  return items;
}

function openWindow(kind: 'diary' | 'inspector' | 'settings'): void {
  try {
    getWindowManager().open(kind);
  } catch (err) {
    console.error(`[tray] open ${kind} failed:`, err);
  }
}

interface PendingReminder {
  context: string;
  fires_at: string;
}

function listPendingReminders(): PendingReminder[] {
  return getDb()
    .prepare(
      `SELECT context, fires_at FROM reminders
       WHERE fired_at IS NULL
       ORDER BY fires_at ASC LIMIT 100`,
    )
    .all() as PendingReminder[];
}

async function restartTunnel(): Promise<void> {
  // Restart goes through the IPC handler so the same code path runs whether
  // the trigger is tray or renderer Settings.
  const { ipcMain } = await import('electron');
  ipcMain.emit('digest:restartTunnel');
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
