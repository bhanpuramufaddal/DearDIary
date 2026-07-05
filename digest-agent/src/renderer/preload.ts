/**
 * contextBridge — the renderer's view of the main API.
 *
 * Bundled as CJS (esbuild config) so contextIsolation can load it before the
 * page scripts. `window.digest` is the only surface the renderer touches;
 * everything else (Node, fs, ipcRenderer) stays behind the bridge.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type Unsubscribe = () => void;

interface BusMessage {
  kind: string;
  payload: unknown;
}

contextBridge.exposeInMainWorld('digest', {
  getDiary(date?: string): Promise<unknown> {
    return ipcRenderer.invoke('digest:getDiary', { date });
  },
  addComment(component_id: string, text: string): Promise<{ id: string }> {
    return ipcRenderer.invoke('digest:addComment', { component_id, text });
  },
  addNote(text: string, date?: string): Promise<{ id: string }> {
    return ipcRenderer.invoke('digest:addNote', { text, date });
  },
  fireTask(req: {
    component_id: string;
    action: { id: string; kind: string };
    principal_input?: unknown;
  }): Promise<{ task_id: string }> {
    return ipcRenderer.invoke('digest:fireTask', req);
  },
  readConfig(): Promise<unknown> {
    return ipcRenderer.invoke('digest:readConfig');
  },
  writeConfig(cfg: unknown): Promise<{ ok: true }> {
    return ipcRenderer.invoke('digest:writeConfig', cfg);
  },
  inspect(req: {
    table: 'anchors' | 'entities' | 'events' | 'thinking_layer' | 'predictions';
    limit?: number;
    date?: string;
  }): Promise<unknown[]> {
    return ipcRenderer.invoke('digest:inspect', req);
  },
  inspectAnchor(id: string): Promise<unknown> {
    return ipcRenderer.invoke('digest:inspectAnchor', id);
  },
  lookupArtifacts(
    source_ids: string[],
  ): Promise<Record<string, { kind: string; attribution: string; date: string }>> {
    return ipcRenderer.invoke('digest:lookupArtifacts', { source_ids });
  },
  listReminders(): Promise<unknown[]> {
    return ipcRenderer.invoke('digest:listReminders');
  },
  restartTunnel(): Promise<{ ok: true }> {
    return ipcRenderer.invoke('digest:restartTunnel');
  },
  /**
   * Subscribe to bus events. Returns an unsubscribe handle.
   * The renderer is responsible for filtering by `kind`.
   */
  onUpdate(cb: (msg: BusMessage) => void): Unsubscribe {
    const listener = (_e: IpcRendererEvent, msg: BusMessage): void => cb(msg);
    ipcRenderer.on('digest:event', listener);
    return (): void => {
      ipcRenderer.removeListener('digest:event', listener);
    };
  },
  /**
   * Subscribe to the diary's refresh-on-show signal. Main fires this every
   * time the diary window becomes visible, with the current day so the
   * renderer can re-paint if the rendered date is stale.
   */
  onDiaryShow(cb: (msg: { today: string }) => void): Unsubscribe {
    const listener = (_e: IpcRendererEvent, msg: { today: string }): void => cb(msg);
    ipcRenderer.on('diary:show', listener);
    return (): void => {
      ipcRenderer.removeListener('diary:show', listener);
    };
  },
});
