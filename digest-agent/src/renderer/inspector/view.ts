/**
 * Inspector — browse the substrate (anchors, entities, predictions), the
 * event audit log, and today's thinking-layer entries.
 *
 * Phase 12: clicking an anchor row opens a detail pane (right) with the
 * anchor's identity handles, slow layer, relationships, predictions, and
 * case base — rendered as prose rather than raw JSON.
 *
 * Search filters in-memory (cheap; tables are small).
 */

import './frame.css';

type Table = 'anchors' | 'entities' | 'events' | 'predictions' | 'thinking_layer';

interface AnchorRow { id: string; kind: string; slow_content: string;
  slow_precision: number; activation_score?: number; last_bumped?: string; }
interface RelationshipRow { id: string; target_id: string; claim: string;
  precision: number; created_at: string; }
interface PredictionRow { id: string; kind: string; claim: string;
  expected_by?: string | null; created_at: string; }
interface CaseBaseRow { id: string; node_layer: string; content: string;
  source_id?: string | null; created_at: string; }

const TABS: { id: Table; label: string }[] = [
  { id: 'anchors', label: 'Anchors' },
  { id: 'entities', label: 'Entities' },
  { id: 'predictions', label: 'Predictions' },
  { id: 'events', label: 'Events' },
  { id: 'thinking_layer', label: "Today's thinking" },
];

const root = document.getElementById('root')!;

let activeTab: Table = 'anchors';
let rows: Record<string, unknown>[] = [];
let filter = '';
let selectedId: string | null = null;

const shell = document.createElement('div');
shell.className = 'inspector';

const header = document.createElement('div');
header.className = 'header';
const title = document.createElement('h1');
title.textContent = 'Inspector';
const metaInfo = document.createElement('div');
metaInfo.className = 'meta';
header.appendChild(title);
header.appendChild(metaInfo);
shell.appendChild(header);

const tabs = document.createElement('div');
tabs.className = 'tabs';
for (const t of TABS) {
  const btn = document.createElement('button');
  btn.className = 'tab';
  btn.dataset['tab'] = t.id;
  btn.textContent = t.label;
  btn.setAttribute('aria-selected', t.id === activeTab ? 'true' : 'false');
  btn.addEventListener('click', () => setTab(t.id));
  tabs.appendChild(btn);
}
const searchInput = document.createElement('input');
searchInput.type = 'text';
searchInput.placeholder = 'filter…';
searchInput.className = 'search';
searchInput.addEventListener('input', () => {
  filter = searchInput.value.toLowerCase();
  paint();
});
tabs.appendChild(searchInput);
shell.appendChild(tabs);

const layout = document.createElement('div');
layout.className = 'layout';
const listPane = document.createElement('div');
const detailPane = document.createElement('div');
detailPane.className = 'detail';
layout.appendChild(listPane);
shell.appendChild(layout);

root.appendChild(shell);

function setTab(tab: Table): void {
  activeTab = tab;
  selectedId = null;
  searchInput.value = '';
  filter = '';
  for (const btn of tabs.querySelectorAll<HTMLButtonElement>('.tab')) {
    btn.setAttribute('aria-selected', btn.dataset['tab'] === tab ? 'true' : 'false');
  }
  void refresh();
}

async function refresh(): Promise<void> {
  listPane.replaceChildren();
  detailPane.replaceChildren();
  layout.classList.remove('with-detail');
  detailPane.remove();
  try {
    rows = await window.digest.inspect({ table: activeTab, limit: 200 });
    metaInfo.textContent = `${rows.length} row(s)`;
    paint();
  } catch (err) {
    listPane.appendChild(emptyMessage(err instanceof Error ? err.message : String(err)));
  }
}

function paint(): void {
  const filtered = filter
    ? rows.filter((row) =>
        Object.values(row)
          .map((v) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')))
          .join(' ')
          .toLowerCase()
          .includes(filter),
      )
    : rows;
  listPane.replaceChildren();
  if (filtered.length === 0) {
    listPane.appendChild(emptyMessage('no rows'));
    return;
  }
  listPane.appendChild(renderTable(filtered));
}

function renderTable(data: Record<string, unknown>[]): HTMLElement {
  const headers = Object.keys(data[0]!);
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  const clickable = activeTab === 'anchors';
  for (const row of data) {
    const tr = document.createElement('tr');
    tr.className = `row${clickable ? ' clickable' : ''}${
      clickable && row['id'] === selectedId ? ' selected' : ''
    }`;
    for (const h of headers) {
      const td = document.createElement('td');
      const v = row[h];
      td.textContent =
        v === null || v === undefined
          ? '·'
          : typeof v === 'string'
            ? v
            : JSON.stringify(v);
      tr.appendChild(td);
    }
    if (clickable && typeof row['id'] === 'string') {
      const id = row['id'];
      tr.addEventListener('click', () => {
        selectedId = id;
        paint();
        void openAnchorDetail(id);
      });
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

let detailRequestSeq = 0;

async function openAnchorDetail(id: string): Promise<void> {
  const requestId = ++detailRequestSeq;
  layout.classList.add('with-detail');
  if (!detailPane.isConnected) layout.appendChild(detailPane);
  detailPane.replaceChildren(loadingMessage('loading…'));
  try {
    const result = (await window.digest.inspectAnchor(id)) as {
      anchor: AnchorRow;
      identity_handles: { handle: string }[];
      relationships: RelationshipRow[];
      predictions: PredictionRow[];
      case_base: CaseBaseRow[];
    } | null;
    // Drop stale responses — only the latest click wins the pane.
    if (requestId !== detailRequestSeq) return;
    if (!result) {
      detailPane.replaceChildren(emptyMessage('anchor not found'));
      return;
    }
    renderAnchorDetail(result);
  } catch (err) {
    if (requestId !== detailRequestSeq) return;
    detailPane.replaceChildren(emptyMessage(err instanceof Error ? err.message : String(err)));
  }
}

function renderAnchorDetail(d: {
  anchor: AnchorRow;
  identity_handles: { handle: string }[];
  relationships: RelationshipRow[];
  predictions: PredictionRow[];
  case_base: CaseBaseRow[];
}): void {
  detailPane.replaceChildren();
  const close = document.createElement('button');
  close.className = 'close-btn';
  close.textContent = '×';
  close.title = 'close';
  close.addEventListener('click', () => {
    selectedId = null;
    paint();
    layout.classList.remove('with-detail');
    detailPane.remove();
  });
  detailPane.appendChild(close);

  detailPane.appendChild(makeTextEl('h2', d.anchor.id));
  detailPane.appendChild(makeTextEl('p', d.anchor.kind, { className: 'id' }));

  detailPane.appendChild(makeTextEl('div', 'Slow layer', { className: 'section-title' }));
  const slow = document.createElement('p');
  slow.className = 'layer-content';
  slow.textContent = d.anchor.slow_content || '—';
  const tag = document.createElement('span');
  tag.className = 'precision-tag';
  tag.textContent = `precision ${d.anchor.slow_precision.toFixed(2)}`;
  slow.appendChild(tag);
  detailPane.appendChild(slow);

  if (d.identity_handles.length) {
    detailPane.appendChild(makeTextEl('div', 'Identity handles', { className: 'section-title' }));
    const ul = document.createElement('ul');
    for (const h of d.identity_handles) {
      const li = document.createElement('li');
      li.textContent = h.handle;
      ul.appendChild(li);
    }
    detailPane.appendChild(ul);
  }

  if (d.relationships.length) {
    detailPane.appendChild(makeTextEl('div', 'Relationships', { className: 'section-title' }));
    const ul = document.createElement('ul');
    for (const r of d.relationships) {
      const li = document.createElement('li');
      li.textContent = `→ ${r.target_id}: ${r.claim}`;
      const tag2 = document.createElement('span');
      tag2.className = 'precision-tag';
      tag2.textContent = `precision ${r.precision.toFixed(2)}`;
      li.appendChild(tag2);
      ul.appendChild(li);
    }
    detailPane.appendChild(ul);
  }

  if (d.predictions.length) {
    detailPane.appendChild(makeTextEl('div', 'Predictions', { className: 'section-title' }));
    const ul = document.createElement('ul');
    for (const p of d.predictions) {
      const li = document.createElement('li');
      li.textContent = `[${p.kind}] ${p.claim}` + (p.expected_by ? `, expected by ${p.expected_by}` : '');
      ul.appendChild(li);
    }
    detailPane.appendChild(ul);
  }

  if (d.case_base.length) {
    detailPane.appendChild(makeTextEl('div', 'Case base', { className: 'section-title' }));
    const ul = document.createElement('ul');
    for (const c of d.case_base) {
      const li = document.createElement('li');
      const date = c.created_at.slice(0, 10);
      li.textContent = `${date} · [${c.node_layer}] ${c.content}`;
      ul.appendChild(li);
    }
    detailPane.appendChild(ul);
  }
}

function emptyMessage(msg: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = msg;
  return p;
}

function loadingMessage(msg: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = msg;
  return p;
}

function makeTextEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
  props?: { className?: string },
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (props?.className) node.className = props.className;
  return node;
}

// Initial render.
setTab('anchors');

// Live refresh.
window.digest.onUpdate((msg) => {
  if (
    msg.kind.startsWith('mind.') ||
    msg.kind.startsWith('diary.') ||
    msg.kind.startsWith('task.') ||
    msg.kind === 'profile.changed'
  ) {
    void refresh();
  }
});
