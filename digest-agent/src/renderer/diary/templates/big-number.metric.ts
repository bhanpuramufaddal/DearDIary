/**
 * big-number.metric — hero metric tile. Big numerical value, a label,
 * a delta with direction, optional inline sparkline (Chart.js line),
 * and a paraphrased context paragraph beneath.
 */

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
} from 'chart.js';

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, rationale } from './_shared.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler);

type Content = Partial<TemplateContentByTemplateId['big-number.metric']>;

export const renderBigNumberMetric: TemplateRender = (component, container, deps) => {
  container.appendChild(headline(component.headline ?? 'Metric'));
  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  const c = (component.content ?? {}) as Content;

  const hero = el('div', { className: 'big-number__hero' });
  hero.style.display = 'flex';
  hero.style.alignItems = 'baseline';
  hero.style.gap = '14px';
  hero.style.flexWrap = 'wrap';

  const valueEl = el('div', { className: 'big-number__value' });
  valueEl.style.fontSize = '2.6rem';
  valueEl.style.fontWeight = '600';
  valueEl.style.lineHeight = '1';
  valueEl.textContent = c.value ?? '—';
  hero.appendChild(valueEl);

  if (c.label) {
    const labelEl = el('div', { className: 'big-number__label' });
    labelEl.style.fontSize = 'var(--t-small)';
    labelEl.style.opacity = '0.7';
    labelEl.textContent = c.label;
    hero.appendChild(labelEl);
  }

  if (c.delta) {
    const arrow = c.delta.direction === 'up' ? '↑' : c.delta.direction === 'down' ? '↓' : '·';
    const deltaEl = el('div', { className: `big-number__delta big-number__delta--${c.delta.direction}` });
    deltaEl.style.fontSize = 'var(--t-small)';
    deltaEl.textContent = `${arrow} ${c.delta.text}`;
    hero.appendChild(deltaEl);
  }

  container.appendChild(hero);

  if (c.sparkline && c.sparkline.length >= 2) {
    const wrap = el('div', { className: 'big-number__sparkline' });
    wrap.style.height = '60px';
    wrap.style.marginTop = '8px';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: c.sparkline.map((p) => p.t),
        datasets: [
          {
            data: c.sparkline.map((p) => p.y),
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.25,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
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
