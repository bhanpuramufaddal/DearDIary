import type { AnchorId, DiaryComponentId, PredictionId } from '@shared/types/ids.js';
import type {
  ComponentStatus,
  Diary,
  DiaryComponent,
  DiarySection,
  TemplateId,
} from '@shared/types/diary.js';
import type { Db } from './index.js';
import { makeStatementCache } from './index.js';

export function makeDiaryRepo(db: Db) {
  const stmt = makeStatementCache(db);

  function ensureDay(date: string): void {
    stmt('INSERT OR IGNORE INTO diary_days (date) VALUES (?)').run(date);
  }

  return {
    ensureDay,

    listDates(limit = 60): string[] {
      return (
        stmt('SELECT date FROM diary_days ORDER BY date DESC LIMIT ?').all(limit) as {
          date: string;
        }[]
      ).map((r) => r.date);
    },

    /**
     * Assemble the on-the-wire Diary JSON from rows.
     */
    assembleDiary(date: string): Diary {
      const componentRows = stmt(
        `SELECT * FROM diary_components WHERE diary_date = ? ORDER BY section, position ASC`,
      ).all(date) as ComponentRow[];

      const components: DiaryComponent[] = componentRows.map((c) => {
        const anchorRefs = (
          stmt(
            'SELECT anchor_id FROM diary_component_anchor_refs WHERE component_id = ? ORDER BY position ASC',
          ).all(c.id) as { anchor_id: AnchorId }[]
        ).map((r) => r.anchor_id);

        const comments = (
          stmt(
            'SELECT id, component_id, text, created_at FROM diary_comments WHERE component_id = ? ORDER BY created_at ASC',
          ).all(c.id) as CommentRowOut[]
        ).map((r) => ({
          id: r.id as DiaryComponent['comments'][number]['id'],
          component_id: r.component_id as DiaryComponentId,
          text: r.text,
          created_at: r.created_at,
        }));

        return {
          id: c.id as DiaryComponentId,
          diary_date: c.diary_date,
          type: c.type as DiaryComponent['type'],
          section: c.section,
          template_id: c.template_id as TemplateId,
          anchor_refs: anchorRefs,
          supporting_artifact_ids: JSON.parse(
            c.supporting_artifact_ids ?? '[]',
          ) as string[],
          headline: c.headline ?? undefined,
          rationale: c.rationale ?? undefined,
          content: JSON.parse(c.content) as Record<string, unknown>,
          actions: JSON.parse(c.actions) as DiaryComponent['actions'],
          status: c.status as ComponentStatus,
          comments,
          efference_prediction_id: (c.efference_prediction_id ?? undefined) as
            | PredictionId
            | undefined,
        };
      });

      // Section keys are agent-chosen; build the record dynamically.
      const sections: Record<string, DiaryComponent[]> = {};
      for (const comp of components) {
        if (!sections[comp.section]) sections[comp.section] = [];
        sections[comp.section]!.push(comp);
      }

      const notes = (
        stmt(
          'SELECT id, diary_date, text, created_at FROM diary_notes WHERE diary_date = ? ORDER BY created_at ASC',
        ).all(date) as NoteRowOut[]
      ).map((r) => ({
        id: r.id as Diary['notes'][number]['id'],
        diary_date: r.diary_date,
        text: r.text,
        created_at: r.created_at,
      }));

      const thinking_layer = (
        stmt(
          'SELECT id, diary_date, tick_at, entries FROM diary_thinking_entries WHERE diary_date = ? ORDER BY tick_at ASC',
        ).all(date) as ThinkingRowOut[]
      ).map((r) => ({
        id: r.id as Diary['thinking_layer'][number]['id'],
        diary_date: r.diary_date,
        tick_at: r.tick_at,
        entries: JSON.parse(r.entries) as string[],
      }));

      return { date, sections, notes, thinking_layer };
    },

    /**
     * Persist a Diary JSON.
     *
     * UPSERTs components by id rather than delete-then-insert, so that
     * `diary_comments` (which FK against diary_components.id with ON DELETE CASCADE)
     * survive across diary re-ticks within the same day. A component carried
     * across re-ticks keeps its comments; a component dropped by the re-tick
     * (id not in the new payload) is deleted, taking its comments with it
     * (the principal's commentary on a dropped item has nowhere meaningful to live).
     *
     * `diary_component_anchor_refs` for each surviving component are rebuilt
     * from the payload (the diary agent re-asserts anchor refs per tick).
     *
     * Notes and thinking entries are NOT touched here — they're append-only via
     * `addNote` / `appendThinkingEntry`.
     */
    persistDiary(diary: Diary): void {
      ensureDay(diary.date);

      const upsertComponent = stmt(
        `INSERT INTO diary_components (id, diary_date, type, section, headline, rationale,
                                        template_id, content, actions, status,
                                        efference_prediction_id, position,
                                        supporting_artifact_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           section = excluded.section,
           headline = excluded.headline,
           rationale = excluded.rationale,
           template_id = excluded.template_id,
           content = excluded.content,
           actions = excluded.actions,
           status = excluded.status,
           efference_prediction_id = excluded.efference_prediction_id,
           position = excluded.position,
           supporting_artifact_ids = excluded.supporting_artifact_ids`,
      );
      const clearAnchorRefs = stmt(
        'DELETE FROM diary_component_anchor_refs WHERE component_id = ?',
      );
      const insertAnchorRef = stmt(
        'INSERT INTO diary_component_anchor_refs (component_id, anchor_id, position, is_primary) VALUES (?, ?, ?, ?)',
      );

      const tx = db.transaction(() => {
        // Section labels are agent-chosen — iterate whatever keys the payload
        // carries. Within each section, position follows array order.
        const survivingIds: string[] = [];

        for (const [section, components] of Object.entries(diary.sections)) {
          for (let i = 0; i < components.length; i++) {
            const c = components[i]!;
            upsertComponent.run(
              c.id,
              diary.date,
              c.type,
              section,
              c.headline ?? null,
              c.rationale ?? null,
              c.template_id,
              JSON.stringify(c.content ?? {}),
              JSON.stringify(c.actions ?? []),
              c.status,
              c.efference_prediction_id ?? null,
              i,
              JSON.stringify(c.supporting_artifact_ids ?? []),
            );
            clearAnchorRefs.run(c.id);
            for (let j = 0; j < c.anchor_refs.length; j++) {
              insertAnchorRef.run(c.id, c.anchor_refs[j], j, j === 0 ? 1 : 0);
            }
            survivingIds.push(c.id);
          }
        }

        // Drop components for this date whose id is not in the new payload.
        // ON DELETE CASCADE removes their comments + anchor refs.
        if (survivingIds.length === 0) {
          db.prepare('DELETE FROM diary_components WHERE diary_date = ?').run(diary.date);
        } else {
          const placeholders = survivingIds.map(() => '?').join(',');
          db.prepare(
            `DELETE FROM diary_components WHERE diary_date = ? AND id NOT IN (${placeholders})`,
          ).run(diary.date, ...survivingIds);
        }
      });
      tx();
    },

    addComment(componentId: DiaryComponentId, id: string, text: string, createdAt: string): void {
      stmt(
        'INSERT INTO diary_comments (id, component_id, text, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, componentId, text, createdAt);
    },

    addNote(diaryDate: string, id: string, text: string, createdAt: string): void {
      ensureDay(diaryDate);
      stmt(
        'INSERT INTO diary_notes (id, diary_date, text, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, diaryDate, text, createdAt);
    },

    appendThinkingEntry(
      diaryDate: string,
      id: string,
      tickAt: string,
      entries: string[],
    ): void {
      ensureDay(diaryDate);
      stmt(
        'INSERT INTO diary_thinking_entries (id, diary_date, tick_at, entries) VALUES (?, ?, ?, ?)',
      ).run(id, diaryDate, tickAt, JSON.stringify(entries));
    },

    updateComponentStatus(id: DiaryComponentId, status: ComponentStatus): void {
      stmt('UPDATE diary_components SET status = ? WHERE id = ?').run(status, id);
    },

    /**
     * Upsert a single component. Used by the per-template MCP tool family —
     * each `write_<template>` call lands one row.
     *
     * Position rules: if the component id already exists, keep its current
     * position (don't re-sort on re-tick). If it's new, append to the section
     * (max position + 1 within that section's existing rows).
     *
     * Anchor refs are cleared + re-inserted, same as the bulk persistDiary
     * path. ON DELETE CASCADE on diary_comments preserves comments across
     * re-ticks as long as the component id is stable.
     */
    upsertComponent(args: {
      id: DiaryComponentId;
      diary_date: string;
      type: DiaryComponent['type'];
      section: DiarySection;
      template_id: TemplateId;
      headline?: string | undefined;
      rationale?: string | undefined;
      content: Record<string, unknown>;
      actions: DiaryComponent['actions'];
      anchor_refs: AnchorId[];
      supporting_artifact_ids?: string[];
      status: ComponentStatus;
      efference_prediction_id?: PredictionId | undefined;
    }): void {
      ensureDay(args.diary_date);
      const tx = db.transaction(() => {
        const existing = stmt(
          'SELECT position FROM diary_components WHERE id = ?',
        ).get(args.id) as { position: number } | undefined;
        const position =
          existing?.position ??
          (
            (stmt(
              'SELECT COALESCE(MAX(position) + 1, 0) AS p FROM diary_components WHERE diary_date = ? AND section = ?',
            ).get(args.diary_date, args.section) as { p: number }) ?? { p: 0 }
          ).p;

        stmt(
          `INSERT INTO diary_components (id, diary_date, type, section, headline, rationale,
                                          template_id, content, actions, status,
                                          efference_prediction_id, position,
                                          supporting_artifact_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             type = excluded.type,
             section = excluded.section,
             headline = excluded.headline,
             rationale = excluded.rationale,
             template_id = excluded.template_id,
             content = excluded.content,
             actions = excluded.actions,
             status = excluded.status,
             efference_prediction_id = excluded.efference_prediction_id,
             supporting_artifact_ids = excluded.supporting_artifact_ids`,
        ).run(
          args.id,
          args.diary_date,
          args.type,
          args.section,
          args.headline ?? null,
          args.rationale ?? null,
          args.template_id,
          JSON.stringify(args.content),
          JSON.stringify(args.actions),
          args.status,
          args.efference_prediction_id ?? null,
          position,
          JSON.stringify(args.supporting_artifact_ids ?? []),
        );

        stmt('DELETE FROM diary_component_anchor_refs WHERE component_id = ?').run(args.id);
        for (let j = 0; j < args.anchor_refs.length; j++) {
          stmt(
            'INSERT INTO diary_component_anchor_refs (component_id, anchor_id, position, is_primary) VALUES (?, ?, ?, ?)',
          ).run(args.id, args.anchor_refs[j]!, j, j === 0 ? 1 : 0);
        }
      });
      tx();
    },

    /**
     * Delete every component for a date (preserves notes + thinking_layer).
     * Used by the diary agent's `clear_diary` MCP tool at the start of a tick
     * when it wants to recompose from scratch.
     *
     * Comments cascade with their components — same as persistDiary's drop
     * semantics for components missing from a re-tick.
     */
    clearComponents(date: string): void {
      stmt('DELETE FROM diary_components WHERE diary_date = ?').run(date);
    },

    /** Delete a single component by id. CASCADE drops its comments + anchor refs. */
    deleteComponent(id: DiaryComponentId): void {
      stmt('DELETE FROM diary_components WHERE id = ?').run(id);
    },
  };
}

interface ComponentRow {
  id: string;
  diary_date: string;
  type: string;
  section: string;
  headline: string | null;
  rationale: string | null;
  template_id: string;
  content: string;
  actions: string;
  status: string;
  efference_prediction_id: string | null;
  position: number;
  supporting_artifact_ids: string | null;
}

interface CommentRowOut {
  id: string;
  component_id: string;
  text: string;
  created_at: string;
}

interface NoteRowOut {
  id: string;
  diary_date: string;
  text: string;
  created_at: string;
}

interface ThinkingRowOut {
  id: string;
  diary_date: string;
  tick_at: string;
  entries: string;
}

