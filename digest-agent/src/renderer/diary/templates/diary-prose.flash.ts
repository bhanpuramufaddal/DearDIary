/**
 * diary-prose.flash — urgent paraphrased prose. Same shape as
 * diary-prose.note, with loud typography. The headline runs at flash
 * weight; the body sits tight underneath.
 */

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el } from './_shared.js';

type Content = Partial<TemplateContentByTemplateId['diary-prose.flash']>;

export const renderDiaryProseFlash: TemplateRender = (component, container, deps) => {
  container.classList.add('component--flash');

  const head = el('h2', { className: 'component__heading component__heading--flash' });
  head.textContent = component.headline ?? 'Right now';
  container.appendChild(head);

  if (component.content) {
    const c = component.content as Content;
    const body = el('div', { className: 'component__body diary-prose__text diary-prose__text--flash' });
    body.style.whiteSpace = 'pre-wrap';
    body.textContent = c.text ?? '';
    container.appendChild(body);
  }

  if (component.actions.length > 0) container.appendChild(actionsRow(component, deps));
};
