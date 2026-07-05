/**
 * Tiny DOM helpers shared by template modules. Kept here rather than as a
 * standalone utility because the templates are the only consumers and the
 * helpers are intentionally minimal (no virtual DOM, no JSX — just functions).
 */

import type { ComponentAction, DiaryComponent } from '@shared/types/diary.js';
import type { TemplateDeps } from './index.js';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]> & { className?: string; textContent?: string },
  children?: (Node | string)[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'className' && typeof v === 'string') node.className = v;
      else if (k === 'textContent' && typeof v === 'string') node.textContent = v;
      else (node as unknown as Record<string, unknown>)[k] = v;
    }
  }
  if (children) {
    for (const c of children) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

export function headline(text: string): HTMLElement {
  return el('h3', { className: 'component__heading', textContent: text });
}

export function meta(text: string): HTMLElement {
  return el('p', { className: 'component__meta', textContent: text });
}

export function rationale(text: string | undefined): HTMLElement | null {
  if (!text) return null;
  return el('blockquote', { className: 'component__quote', textContent: text });
}

/**
 * Render the action row. Each action becomes a button whose click handler
 * fires the corresponding task. If `principalInputCollector` returns a value,
 * that value is forwarded as `principal_input`.
 */
export function actionsRow(
  component: DiaryComponent,
  deps: TemplateDeps,
  opts?: {
    principalInputCollector?: (action: ComponentAction) => unknown;
    onFired?: (action: ComponentAction) => void;
  },
): HTMLElement {
  const row = el('div', { className: 'component__actions' });
  component.actions.forEach((action, i) => {
    const btn = el('button', {
      className: `action${i === 0 ? ' action--primary' : ' action--ghost'}`,
      textContent: action.label,
    });
    btn.addEventListener('click', async () => {
      try {
        const principal_input = opts?.principalInputCollector
          ? opts.principalInputCollector(action)
          : undefined;
        await deps.fireTask({
          component_id: component.id,
          action: { id: action.id, kind: action.kind },
          ...(principal_input !== undefined ? { principal_input } : {}),
        });
        opts?.onFired?.(action);
      } catch (err) {
        console.error('[diary] fireTask failed:', err);
      }
    });
    row.appendChild(btn);
  });
  return row;
}
