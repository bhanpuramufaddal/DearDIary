/**
 * stat-block.summary — 3–6 metric rows with a paraphrased context paragraph.
 * The summary frames the cluster; the rows are factual.
 */

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, rationale } from './_shared.js';

type Content = Partial<TemplateContentByTemplateId['stat-block.summary']>;

export const renderStatBlockSummary: TemplateRender = (component, container, deps) => {
  container.appendChild(headline(component.headline ?? 'Roll-up'));
  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  const c = (component.content ?? {}) as Content;

  if (c.context_summary) {
    const ctx = el('div', { className: 'component__quote' });
    ctx.style.fontSize = 'var(--t-small)';
    ctx.textContent = c.context_summary;
    container.appendChild(ctx);
  }

  if (c.rows && c.rows.length) {
    const grid = el('div', { className: 'stat-block__grid' });
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(160px, 1fr))';
    grid.style.gap = '12px';
    grid.style.marginTop = '10px';

    for (const row of c.rows) {
      const cell = el('div', { className: 'stat-block__cell' });
      const lbl = el('div', { className: 'stat-block__label' });
      lbl.style.fontSize = 'var(--t-small)';
      lbl.style.opacity = '0.7';
      lbl.textContent = row.label;
      const val = el('div', { className: 'stat-block__value' });
      val.style.fontSize = '1.6rem';
      val.style.fontWeight = '600';
      val.style.lineHeight = '1.1';
      val.textContent = row.value;
      cell.appendChild(lbl);
      cell.appendChild(val);
      if (row.delta) {
        const arrow = row.delta.direction === 'up' ? '↑' : row.delta.direction === 'down' ? '↓' : '·';
        const d = el('div', { className: `stat-block__delta stat-block__delta--${row.delta.direction}` });
        d.style.fontSize = 'var(--t-small)';
        d.textContent = `${arrow} ${row.delta.text}`;
        cell.appendChild(d);
      }
      grid.appendChild(cell);
    }

    container.appendChild(grid);
  }

  if (component.actions.length > 0) container.appendChild(actionsRow(component, deps));
};
