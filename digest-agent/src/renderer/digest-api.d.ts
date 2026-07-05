/**
 * Type declarations for the renderer's `window.digest` API and for esbuild's
 * non-TS imports (SVG as text, CSS as side-effect).
 *
 * The implementation is in preload.ts; this file just declares its shape so
 * every renderer bundle agrees on what's available.
 */

import type { Diary } from '@shared/types/diary.js';

export interface DigestApi {
  getDiary(date?: string): Promise<Diary>;
  addComment(componentId: string, text: string): Promise<{ id: string }>;
  addNote(text: string, date?: string): Promise<{ id: string }>;
  fireTask(req: {
    component_id: string;
    action: { id: string; kind: string };
    principal_input?: unknown;
  }): Promise<{ task_id: string }>;
  readConfig(): Promise<unknown>;
  writeConfig(cfg: unknown): Promise<{ ok: true }>;
  inspect(req: {
    table: 'anchors' | 'entities' | 'events' | 'thinking_layer' | 'predictions';
    limit?: number;
    date?: string;
  }): Promise<Record<string, unknown>[]>;
  inspectAnchor(id: string): Promise<unknown>;
  listReminders(): Promise<Record<string, unknown>[]>;
  restartTunnel(): Promise<{ ok: true }>;
  lookupArtifacts(
    sourceIds: string[],
  ): Promise<Record<string, { kind: string; attribution: string; date: string }>>;
  onUpdate(cb: (msg: { kind: string; payload: unknown }) => void): () => void;
  onDiaryShow(cb: (msg: { today: string }) => void): () => void;
}

declare global {
  interface Window {
    digest: DigestApi;
  }
}

