/**
 * email-draft.inline — the diary's outbound-email template.
 *
 * Renders, top to bottom:
 *   1. Headline (component.headline or content.subject).
 *   2. Recipients meta line ("To: …  ·  cc: …").
 *   3. Rationale (why surface this now).
 *   4. context_summary — the diary agent's paraphrased recall cue, drawn from
 *      everything it knows about the matter, not just the immediate thread.
 *   5. The draft (subject + body).
 *   6. Tweak affordance + Send.
 *
 * The body is read-only by default; clicking "Tweak before sending" turns
 * it into a textarea whose value rides along as
 * `principal_input.body_override` on the next Send.
 */

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, meta, rationale } from './_shared.js';

// Single source of truth — src/shared/templates/email-draft.inline.ts. Partial
// for legacy-data safety; drop once step-4 MCP tools enforce the registry shape.
type EmailDraftContent = Partial<TemplateContentByTemplateId['email-draft.inline']>;

export const renderEmailDraftInline: TemplateRender = (component, container, deps) => {
  const content = component.content as EmailDraftContent;
  container.appendChild(headline(component.headline ?? content.subject ?? 'Email draft'));
  if (content.to && content.to.length) {
    container.appendChild(meta(`To: ${content.to.join(', ')}` + (content.cc?.length ? `   ·   cc: ${content.cc.join(', ')}` : '')));
  }
  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  if (content.context_summary) {
    const ctx = el('div', { className: 'component__quote' });
    ctx.style.fontSize = 'var(--t-small)';
    ctx.textContent = content.context_summary;
    container.appendChild(ctx);
  }

  const body = el('div', { className: 'component__body' });
  if (content.subject) {
    body.appendChild(el('p', { className: 'email-draft__subject', textContent: content.subject }));
  }

  const bodyText = el('div', { className: 'email-draft__body', textContent: content.body ?? '' });
  body.appendChild(bodyText);

  let editor: HTMLTextAreaElement | null = null;
  container.appendChild(body);

  container.appendChild(
    actionsRow(component, deps, {
      principalInputCollector: (action) => {
        if (action.kind !== 'send_email') return undefined;
        if (editor) return { body_override: editor.value };
        return undefined;
      },
    }),
  );

  // Inline "Tweak" affordance — drop in a textarea bound to body content.
  const tweak = el('button', {
    className: 'action action--ghost',
    textContent: 'Tweak before sending',
  });
  tweak.style.marginTop = '6px';
  tweak.addEventListener('click', () => {
    if (editor) return; // already showing
    editor = el('textarea') as HTMLTextAreaElement;
    editor.className = 'free-text-reply';
    editor.value = content.body ?? '';
    editor.style.width = '100%';
    editor.style.minHeight = '160px';
    editor.style.marginTop = '8px';
    bodyText.replaceWith(editor);
    tweak.remove();
  });
  body.appendChild(tweak);
};
