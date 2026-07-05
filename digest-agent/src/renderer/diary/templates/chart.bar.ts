/**
 * chart.bar — categorical bar chart. 2–20 bars, ordered as given.
 */

import {
  Chart,
  BarController,
  BarElement,
  LinearScale,
  CategoryScale,
  Tooltip,
} from 'chart.js';

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, rationale } from './_shared.js';

Chart.register(BarController, BarElement, LinearScale, CategoryScale, Tooltip);

type Content = Partial<TemplateContentByTemplateId['chart.bar']>;

export const renderChartBar: TemplateRender = (component, container, deps) => {
  container.appendChild(headline(component.headline ?? 'Comparison'));
  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  const c = (component.content ?? {}) as Content;

  if (c.bars && c.bars.length) {
    const wrap = el('div', { className: 'chart__wrap' });
    wrap.style.height = '220px';
    wrap.style.marginTop = '8px';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: c.bars.map((b) => b.label),
        datasets: [
          {
            data: c.bars.map((b) => b.value),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {},
          y: { title: c.y_axis_label ? { display: true, text: c.y_axis_label } : { display: false } },
        },
      },
    });
  }

  if (c.context_summary) {
    const ctx = el('div', { className: 'component__quote' });
    ctx.style.fontSize = 'var(--t-small)';
    ctx.style.marginTop = '10px';
    ctx.textContent = c.context_summary;
    container.appendChild(ctx);
  }

  if (component.actions.length > 0) container.appendChild(actionsRow(component, deps));
};
