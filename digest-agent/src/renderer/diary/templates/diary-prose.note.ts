/**
 * diary-prose.note — paraphrased prose rendered as a diary-style entry.
 * Headline + the prose body. Optional dismiss action.
 */

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, rationale } from './_shared.js';

type Content = Partial<TemplateContentByTemplateId['diary-prose.note']>;

export const renderDiaryProseNote: TemplateRender = (component, container, deps) => {
  container.appendChild(headline(component.headline ?? 'Note'));
  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  if (component.content) {
    const c = component.content as Content;
    const body = el('div', { className: 'component__body diary-prose__text' });
    body.style.whiteSpace = 'pre-wrap';
    body.textContent = c.text ?? '';
    container.appendChild(body);
  }

  if (component.actions.length > 0) container.appendChild(actionsRow(component, deps));
};
