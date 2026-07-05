/**
 * choose-one.cards — a forced multi-choice (e.g. "which of these meetings
 * matters most this week?"). Selecting a card highlights it; the principal
 * then taps a Confirm action which carries the chosen card's id as
 * principal_input.option_id.
 */

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, rationale } from './_shared.js';

// Single source of truth — src/shared/templates/choose-one.cards.ts.
// Partial for legacy-data safety; drop once step-4 MCP tools enforce.
type ChooseOneContent = Partial<TemplateContentByTemplateId['choose-one.cards']>;

export const renderChooseOneCards: TemplateRender = (component, container, deps) => {
  const content = component.content as ChooseOneContent;
  container.appendChild(headline(component.headline ?? content.prompt ?? 'Pick one'));
  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  const body = el('div', { className: 'component__body' });
  if (content.prompt && content.prompt !== component.headline) {
    body.appendChild(el('p', { textContent: content.prompt }));
  }

  let selectedId: string | null = null;
  const grid = el('div', { className: 'choose-one' });

  for (const opt of content.options ?? []) {
    const card = el('button', { className: 'choose-one__card' });
    card.setAttribute('aria-selected', 'false');
    const lab = el('div');
    lab.style.fontWeight = '600';
    lab.textContent = opt.label;
    card.appendChild(lab);
    if (opt.detail) {
      const detail = el('div', { className: 'component__meta', textContent: opt.detail });
      detail.style.margin = '4px 0 0';
      card.appendChild(detail);
    }
    card.addEventListener('click', () => {
      selectedId = opt.id;
      for (const sibling of grid.querySelectorAll('.choose-one__card')) {
        sibling.setAttribute('aria-selected', 'false');
      }
      card.setAttribute('aria-selected', 'true');
    });
    grid.appendChild(card);
  }
  body.appendChild(grid);

  container.appendChild(body);
  container.appendChild(
    actionsRow(component, deps, {
      principalInputCollector: () => (selectedId ? { option_id: selectedId } : undefined),
    }),
  );
};
