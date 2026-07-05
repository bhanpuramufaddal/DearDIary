/**
 * HITL template registry — maps a component's template_id to its renderer.
 *
 * Each template module exports a `render(component, container, deps)` function
 * that paints the component into the container. Templates may call:
 *   - deps.fireTask({...})    to record an action and emit task.fired
 *   - deps.addComment(id, t)  to attach a comment + emit diary.comment.added
 *
 * Mutating bus events flow through the IPC bridge (preload.ts → ipc.ts).
 */

import type { DiaryComponent, TemplateId } from '@shared/types/diary.js';
import { renderEmailDraftInline } from './email-draft.inline.js';
import { renderCalendarBlockDecision } from './calendar-block.decision.js';
import { renderChooseOneCards } from './choose-one.cards.js';
import { renderFreeTextReplyCompose } from './free-text-reply.compose.js';
import { renderDiaryProseNote } from './diary-prose.note.js';
import { renderDiaryProseFlash } from './diary-prose.flash.js';
import { renderBigNumberMetric } from './big-number.metric.js';
import { renderStatBlockSummary } from './stat-block.summary.js';
import { renderChartTimeseries } from './chart.timeseries.js';
import { renderChartBar } from './chart.bar.js';
import { renderReportBrief } from './report.brief.js';

export interface TemplateDeps {
  fireTask(req: {
    component_id: string;
    action: { id: string; kind: string };
    principal_input?: unknown;
  }): Promise<{ task_id: string }>;
  addComment(componentId: string, text: string): Promise<{ id: string }>;
  /**
   * Map of source_id → citation parts (kind / attribution / date) populated
   * once per paint via the `digest:lookupArtifacts` IPC. The wrapper
   * renderer in `view.ts` paints the inline citations row using this map;
   * per-template renderers can ignore it.
   */
  artifactLookup?: Record<string, { kind: string; attribution: string; date: string }>;
}

export type TemplateRender = (
  component: DiaryComponent,
  container: HTMLElement,
  deps: TemplateDeps,
) => void;

const REGISTRY: Record<TemplateId, TemplateRender> = {
  'email-draft.inline': renderEmailDraftInline,
  'calendar-block.decision': renderCalendarBlockDecision,
  'choose-one.cards': renderChooseOneCards,
  'free-text-reply.compose': renderFreeTextReplyCompose,
  'diary-prose.note': renderDiaryProseNote,
  'diary-prose.flash': renderDiaryProseFlash,
  'big-number.metric': renderBigNumberMetric,
  'stat-block.summary': renderStatBlockSummary,
  'chart.timeseries': renderChartTimeseries,
  'chart.bar': renderChartBar,
  'report.brief': renderReportBrief,
};

export function templateFor(id: TemplateId): TemplateRender {
  return REGISTRY[id] ?? renderFallback;
}

const renderFallback: TemplateRender = (component, container) => {
  const h = document.createElement('h3');
  h.className = 'component__heading';
  h.textContent = component.headline ?? component.id;
  container.appendChild(h);
  const meta = document.createElement('p');
  meta.className = 'component__meta';
  meta.textContent = `no renderer for template "${component.template_id}"`;
  container.appendChild(meta);
};
