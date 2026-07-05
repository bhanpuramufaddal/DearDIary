/**
 * report.brief — long-form structured report. Walks the blocks array,
 * painting prose paragraphs and inline Chart.js charts in order.
 */

import {
  Chart,
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Legend,
  Tooltip,
} from 'chart.js';

import type { TemplateContentByTemplateId } from '@shared/templates/index.js';
import type { TemplateRender } from './index.js';
import { actionsRow, el, headline, rationale } from './_shared.js';

Chart.register(
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Legend,
  Tooltip,
);

type Content = Partial<TemplateContentByTemplateId['report.brief']>;
type Block = NonNullable<Content['blocks']>[number];

function shortLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function paintChartContainer(parent: HTMLElement, caption: string | undefined): HTMLCanvasElement {
  const wrap = el('div', { className: 'report__chart' });
  wrap.style.marginTop = '10px';
  wrap.style.marginBottom = '6px';
  if (caption) {
    const cap = el('div', { className: 'report__chart-caption' });
    cap.style.fontSize = 'var(--t-small)';
    cap.style.opacity = '0.7';
    cap.style.marginBottom = '4px';
    cap.textContent = caption;
    wrap.appendChild(cap);
  }
  const inner = el('div');
  inner.style.height = '220px';
  const canvas = document.createElement('canvas');
  inner.appendChild(canvas);
  wrap.appendChild(inner);
  parent.appendChild(wrap);
  return canvas;
}

function paintBlock(parent: HTMLElement, block: Block): void {
  if (block.kind === 'prose') {
    const p = el('div', { className: 'report__prose' });
    p.style.whiteSpace = 'pre-wrap';
    p.style.lineHeight = '1.55';
    p.style.marginTop = '8px';
    p.textContent = block.text;
    parent.appendChild(p);
    return;
  }
  if (block.kind === 'timeseries') {
    const canvas = paintChartContainer(parent, block.caption);
    const xAxis = block.series[0]!.points.map((p) => shortLabel(p.t));
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: xAxis,
        datasets: block.series.map((s) => ({
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
          x: block.x_axis_label
            ? { title: { display: true, text: block.x_axis_label } }
            : {},
          y: { title: { display: true, text: block.y_axis_label } },
        },
      },
    });
    return;
  }
  if (block.kind === 'bar') {
    const canvas = paintChartContainer(parent, block.caption);
    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: block.bars.map((b) => b.label),
        datasets: [{ data: block.bars.map((b) => b.value), borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {},
          y: { title: { display: true, text: block.y_axis_label } },
        },
      },
    });
  }
}

export const renderReportBrief: TemplateRender = (component, container, deps) => {
  container.appendChild(headline(component.headline ?? 'Brief'));
  const rat = rationale(component.rationale);
  if (rat) container.appendChild(rat);

  const c = (component.content ?? {}) as Content;
  if (c.blocks) {
    for (const block of c.blocks) paintBlock(container, block);
  }

  if (component.actions.length > 0) container.appendChild(actionsRow(component, deps));
};
