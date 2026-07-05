/**
 * calendar-block.decision — a calendar invite or scheduling decision.
 * Renders when, who, where; actions usually are accept/decline/propose.
 */

import calendarSvg from '../illustrations/icon-calendar.svg';
import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, meta, rationale } from './_shared.js';

// Single source of truth — src/shared/templates/calendar-block.decision.ts.
// Partial for legacy-data safety; drop once step-4 MCP tools enforce.
type CalendarBlockContent = Partial<
  TemplateContentByTemplateId['calendar-block.decision']
>;

export const renderCalendarBlockDecision: TemplateRender = (component, container, deps) => {
  const content = component.content as CalendarBlockContent;
  container.appendChild(headline(component.headline ?? content.summary ?? 'Calendar block'));

  const whenStr = content.when_label ?? content.when_iso ?? 'time TBD';
  const whoStr = content.with && content.with.length ? ` · with ${content.with.join(', ')}` : '';
  container.appendChild(meta(`${whenStr}${whoStr}`));

  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  const body = el('div', { className: 'component__body' });

  // Decorative calendar glyph in a flex row with summary.
  const row = el('div', { className: 'doc-tile' });
  const icon = el('div', { className: 'doc-tile__icon' });
  icon.innerHTML = calendarSvg;
  row.appendChild(icon);
  const text = el('div');
  if (content.location) {
    text.appendChild(el('p', { className: 'calendar-block__when', textContent: content.location }));
  }
  if (content.summary) {
    text.appendChild(el('p', { textContent: content.summary }));
  }
  row.appendChild(text);
  body.appendChild(row);

  container.appendChild(body);
  container.appendChild(actionsRow(component, deps));
};
