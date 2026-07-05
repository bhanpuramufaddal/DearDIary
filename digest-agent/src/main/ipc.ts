/**
 * IPC handlers — the bridge between the renderer and main.
 *
 * Renderer calls go through `window.digest.*` (declared in preload.ts) which
 * forwards via ipcRenderer.invoke. Every handler validates input with zod —
 * the renderer is privileged but treating its messages as untrusted is the
 * same discipline we apply to webhooks.
 *
 * Outgoing direction: bus events fan out to every open window via the
 * window manager's '*' subscriber (see windows.ts).
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Bus } from './bus.js';
import type { Db } from './db/index.js';
import { makeDiaryRepo } from './db/diary.js';
import { makeEventsRepo } from './db/events.js';
import { saveConfig } from './config.js';
import { appConfigSchema } from '@shared/schemas/index.js';
import type { AppConfig } from '@shared/types/config.js';
import type { DiaryComponentId, AnchorId, TaskId } from '@shared/types/ids.js';
import type { Diary } from '@shared/types/diary.js';

export interface IpcHandlers {
  register(): void;
  unregister(): void;
}

const GetDiaryArgs = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const AddCommentArgs = z.object({
  component_id: z.string().min(1),
  text: z.string().min(1).max(8000),
});
const AddNoteArgs = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  text: z.string().min(1).max(8000),
});
const FireTaskArgs = z.object({
  component_id: z.string().min(1),
  action: z.object({ id: z.string().min(1), kind: z.string().min(1) }),
  principal_input: z.unknown().optional(),
});

const InspectArgs = z
  .object({
    table: z.enum(['anchors', 'entities', 'events', 'thinking_layer', 'predictions']),
    limit: z.number().int().min(1).max(500).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

const LookupArtifactsArgs = z.object({
  source_ids: z.array(z.string().min(1).max(512)).max(200),
});

const CHANNELS = [
  'digest:getDiary',
  'digest:addComment',
  'digest:addNote',
  'digest:fireTask',
  'digest:readConfig',
  'digest:writeConfig',
  'digest:inspect',
  'digest:inspectAnchor',
  'digest:listReminders',
  'digest:restartTunnel',
  'digest:lookupArtifacts',
] as const;

export function createIpcHandlers(deps: {
  bus: Bus;
  db: Db;
  config: AppConfig;
  /** Called when the user saves a new config; main reloads + may restart tunnel. */
  onConfigSaved?: (cfg: AppConfig) => void | Promise<void>;
  /** Restart the ngrok tunnel — exposed as a tray-menu action via IPC. */
  restartTunnel?: () => Promise<void> | void;
  now?: () => string;
}): IpcHandlers {
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    register() {
      ipcMain.handle('digest:getDiary', (_e, raw: unknown): Diary => {
        const args = GetDiaryArgs.parse(raw ?? {});
        // Default to the injected clock's "today" (the sim clock in test
        // mode), NOT wall-clock — otherwise the initial paint requests the
        // real date while the agent composed for the simulated date, and
        // the window shows an empty page.
        const date = args.date ?? now().slice(0, 10);
        return makeDiaryRepo(deps.db).assembleDiary(date);
      });

      ipcMain.handle('digest:addComment', async (_e, raw: unknown): Promise<{ id: string }> => {
        const args = AddCommentArgs.parse(raw);
        const exists = deps.db
          .prepare('SELECT 1 FROM diary_components WHERE id = ?')
          .get(args.component_id);
        if (!exists) throw new Error(`diary component not found: ${args.component_id}`);
        const id = `cmt_${nanoid(10)}`;
        const createdAt = now();
        makeDiaryRepo(deps.db).addComment(
          args.component_id as DiaryComponentId,
          id,
          args.text,
          createdAt,
        );
        await deps.bus.emit('diary.comment.added', {
          component_id: args.component_id,
          text: args.text,
          created_at: createdAt,
        });
        return { id };
      });

      ipcMain.handle('digest:addNote', async (_e, raw: unknown): Promise<{ id: string }> => {
        const args = AddNoteArgs.parse(raw);
        const date = args.date ?? now().slice(0, 10);
        const id = `note_${nanoid(10)}`;
        const createdAt = now();
        makeDiaryRepo(deps.db).addNote(date, id, args.text, createdAt);
        await deps.bus.emit('diary.note.added', {
          diary_date: date,
          text: args.text,
          created_at: createdAt,
        });
        return { id };
      });

      ipcMain.handle('digest:fireTask', async (_e, raw: unknown): Promise<{ task_id: string }> => {
        const args = FireTaskArgs.parse(raw);
        const compRow = deps.db
          .prepare('SELECT diary_date FROM diary_components WHERE id = ?')
          .get(args.component_id) as { diary_date: string } | undefined;
        if (!compRow) throw new Error(`diary component not found: ${args.component_id}`);
        const anchorIds = (
          deps.db
            .prepare(
              'SELECT anchor_id FROM diary_component_anchor_refs WHERE component_id = ? ORDER BY position ASC',
            )
            .all(args.component_id) as { anchor_id: string }[]
        ).map((r) => r.anchor_id as AnchorId);

        const taskId = `tsk_${nanoid(12)}` as TaskId;
        await deps.bus.emit('task.fired', {
          task_id: taskId,
          component_id: args.component_id as DiaryComponentId,
          diary_date: compRow.diary_date,
          action: args.action,
          principal_input: args.principal_input ?? null,
          context_pointers: { anchor_ids: anchorIds },
        });
        return { task_id: taskId };
      });

      ipcMain.handle('digest:readConfig', (): AppConfig => deps.config);

      ipcMain.handle('digest:writeConfig', async (_e, raw: unknown): Promise<{ ok: true }> => {
        const parsed = appConfigSchema.parse(raw);
        saveConfig(parsed);
        await deps.onConfigSaved?.(parsed);
        return { ok: true };
      });

      ipcMain.handle('digest:listReminders', (): unknown[] => {
        return deps.db
          .prepare(
            `SELECT r.id, r.context, r.fires_at, r.fired_at
             FROM reminders r
             WHERE r.fired_at IS NULL
             ORDER BY r.fires_at ASC
             LIMIT 100`,
          )
          .all() as unknown[];
      });

      ipcMain.handle('digest:restartTunnel', async (): Promise<{ ok: true }> => {
        await deps.restartTunnel?.();
        return { ok: true };
      });

      ipcMain.handle('digest:inspectAnchor', (_e, raw: unknown): unknown => {
        const id = z.string().min(1).max(256).parse(raw);
        const anchor = deps.db
          .prepare(
            `SELECT a.id, a.kind, a.slow_content, a.slow_precision,
                    a.activation, a.last_bumped,
                    n.created_at
             FROM anchors a JOIN nodes n ON n.id = a.id
             WHERE a.id = ?`,
          )
          .get(id);
        if (!anchor) return null;
        const handles = deps.db
          .prepare('SELECT handle FROM anchor_identity_handles WHERE anchor_id = ? ORDER BY position ASC')
          .all(id);
        const rels = deps.db
          .prepare(
            `SELECT id, target_id, claim, precision, created_at
             FROM relationships WHERE subject_id = ? ORDER BY created_at DESC LIMIT 50`,
          )
          .all(id);
        const predictions = deps.db
          .prepare(
            `SELECT p.id, p.kind, p.claim, p.expected_by, p.created_at
             FROM predictions p
             JOIN prediction_layer_bindings b ON b.prediction_id = p.id
             WHERE b.anchor_id = ?
             ORDER BY p.created_at DESC LIMIT 50`,
          )
          .all(id);
        const cases = deps.db
          .prepare(
            `SELECT id, node_layer, content, source_id, created_at
             FROM case_base_entries WHERE node_id = ? ORDER BY created_at DESC LIMIT 50`,
          )
          .all(id);
        return {
          anchor,
          identity_handles: handles,
          relationships: rels,
          predictions,
          case_base: cases,
        };
      });

      // Inspector — read-only browsing of substrate + event log.
      ipcMain.handle(
        'digest:lookupArtifacts',
        (_e, raw: unknown): Record<string, { kind: string; attribution: string; date: string }> => {
          const args = LookupArtifactsArgs.parse(raw ?? {});
          if (args.source_ids.length === 0) return {};
          const rows = makeEventsRepo(deps.db).lookupBySourceIds(args.source_ids);
          const out: Record<string, { kind: string; attribution: string; date: string }> = {};
          for (const r of rows) {
            if (!r.source_id) continue;
            out[r.source_id] = formatArtifact(r);
          }
          return out;
        },
      );

      ipcMain.handle('digest:inspect', (_e, raw: unknown): unknown[] => {
        const args = InspectArgs.parse(raw);
        const limit = args.limit ?? 100;
        const db = deps.db;
        switch (args.table) {
          case 'anchors':
            return db
              .prepare(
                `SELECT a.id, a.kind, a.slow_content, a.slow_precision, a.activation, a.last_bumped
                 FROM anchors a JOIN nodes n ON n.id = a.id
                 ORDER BY a.activation DESC, a.last_bumped DESC LIMIT ?`,
              )
              .all(limit) as unknown[];
          case 'entities':
            return db
              .prepare(
                `SELECT id, kind_hint AS kind, notes, mention_count, last_seen
                 FROM entities ORDER BY last_seen DESC LIMIT ?`,
              )
              .all(limit) as unknown[];
          case 'events':
            return db
              .prepare(
                `SELECT id, kind, occurred_at, observed_at, source_id
                 FROM events ORDER BY id DESC LIMIT ?`,
              )
              .all(limit) as unknown[];
          case 'predictions':
            return db
              .prepare(
                `SELECT id, kind, claim, expected_by, source_dispatchable, created_at
                 FROM predictions ORDER BY created_at DESC LIMIT ?`,
              )
              .all(limit) as unknown[];
          case 'thinking_layer': {
            const date = args.date ?? now().slice(0, 10);
            return db
              .prepare(
                `SELECT id, tick_at, entries FROM diary_thinking_entries
                 WHERE diary_date = ? ORDER BY tick_at DESC LIMIT ?`,
              )
              .all(date, limit) as unknown[];
          }
        }
      });
    },

    unregister() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    },
  };
}

/**
 * Format one source event into a citation marker. The renderer paints it
 * inline as `[email: <attribution>, <date>]` after the rationale / content.
 */
function formatArtifact(
  row: import('./db/events.js').EventRow,
): { kind: string; attribution: string; date: string } {
  const sourceId = row.source_id ?? '';
  const prefix = sourceId.split(':')[0] ?? '';

  // Map source-id prefix → human label.
  const kindLabel: Record<string, string> = {
    gmail: 'email',
    persona: 'email', // persona-emulator events carry email/calendar/note payloads
    gcal: 'cal',
    notion: 'note',
    slack: 'slack',
  };
  const kind = kindLabel[prefix] ?? prefix ?? 'source';

  let attribution = '';
  try {
    const payload = JSON.parse(row.payload) as
      | {
          payload?: { type?: string; data?: Record<string, unknown> };
          data?: Record<string, unknown>;
          from?: string;
        }
      | null;
    if (payload && typeof payload === 'object') {
      const inner = (payload.payload?.data ?? payload.data ?? {}) as Record<
        string,
        unknown
      >;
      // Email
      if (typeof inner['from'] === 'string') attribution = inner['from'] as string;
      // Calendar / note: fall back to title / subject / payload.title
      else if (typeof inner['subject'] === 'string') attribution = inner['subject'] as string;
      else if (typeof inner['title'] === 'string') attribution = inner['title'] as string;
      else if (
        typeof inner['payload'] === 'object' &&
        inner['payload'] &&
        typeof (inner['payload'] as Record<string, unknown>)['title'] === 'string'
      ) {
        attribution = (inner['payload'] as Record<string, unknown>)['title'] as string;
      } else if (typeof inner['filename'] === 'string') {
        attribution = inner['filename'] as string;
      }
    }
  } catch {
    // payload not JSON-parseable; leave attribution blank.
  }

  // Trim attribution to one short token (just the local part of an email, or
  // first 40 chars of a subject) — citations are tight.
  if (attribution.includes('@')) {
    attribution = attribution.split('@')[0] ?? attribution;
  }
  if (attribution.length > 40) attribution = attribution.slice(0, 37) + '…';
  if (!attribution) attribution = sourceId;

  // Format date: prefer occurred_at, fall back to observed_at.
  const isoTs = row.occurred_at ?? row.observed_at ?? '';
  let date = '';
  if (isoTs) {
    const d = new Date(isoTs);
    if (!Number.isNaN(d.getTime())) {
      date = d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  }

  return { kind, attribution, date };
}
