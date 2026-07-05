/**
 * free-text-reply.compose — open-ended composition. The principal writes a
 * message and the execution agent sends it on whatever channel the action.kind
 * selects (slack_send, email_send_inline, …).
 */

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, meta, rationale } from './_shared.js';

// Single source of truth — src/shared/templates/free-text-reply.compose.ts.
// Partial for legacy-data safety; drop once step-4 MCP tools enforce.
type FreeTextContent = Partial<TemplateContentByTemplateId['free-text-reply.compose']>;

export const renderFreeTextReplyCompose: TemplateRender = (component, container, deps) => {
  const content = component.content as FreeTextContent;
  container.appendChild(headline(component.headline ?? content.prompt ?? 'Compose reply'));
  if (content.to || content.channel) {
    container.appendChild(meta([content.to, content.channel].filter(Boolean).join(' · ')));
  }
  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  const body = el('div', { className: 'component__body free-text-reply' });
  if (content.prompt && content.prompt !== component.headline) {
    body.appendChild(el('p', { textContent: content.prompt }));
  }
  const textarea = el('textarea') as HTMLTextAreaElement;
  textarea.placeholder = content.placeholder ?? 'Write a reply…';
  body.appendChild(textarea);

  container.appendChild(body);
  container.appendChild(
    actionsRow(component, deps, {
      principalInputCollector: () => ({ text: textarea.value }),
    }),
  );
};
