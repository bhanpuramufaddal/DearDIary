/**
 * chart.timeseries — line chart over time. 1–4 series of {t, y} points.
 * Renders a Chart.js line chart with a legend, axis labels, and a
 * paraphrased context paragraph beneath.
 */

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Legend,
  Tooltip,
} from 'chart.js';

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, rationale } from './_shared.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Legend, Tooltip);

type Content = Partial<TemplateContentByTemplateId['chart.timeseries']>;

function shortLabel(iso: string): string {
  // Compact "Apr 19" style; avoids pulling in a date adapter.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const renderChartTimeseries: TemplateRender = (component, container, deps) => {
  container.appendChild(headline(component.headline ?? 'Trend'));
  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  const c = (component.content ?? {}) as Content;

  if (c.series && c.series.length) {
    // Use the first series's timestamps as the shared x-axis labels;
    // assume the agent has aligned points across series (cap of 4 series).
    const xAxis = c.series[0]!.points.map((p) => shortLabel(p.t));
    const wrap = el('div', { className: 'chart__wrap' });
    wrap.style.height = '220px';
    wrap.style.marginTop = '8px';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: xAxis,
        datasets: c.series.map((s) => ({
          label: s.name,
          data: s.points.map((p) => p.y),
          borderWidth: 1.8,
          pointRadius: 2,
          tension: 0.2,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
        scales: {
          x: { title: c.x_axis_label ? { display: true, text: c.x_axis_label } : { display: false } },
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
