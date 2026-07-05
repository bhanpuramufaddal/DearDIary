/**
 * Diary view — primary surface of the app. Renders the assembled diary JSON
 * (from `digest:getDiary` IPC) as a sketchbook-styled page with marginalia
 * for status, hand-drawn section dividers, and HITL templates per component.
 *
 * Page navigation: dog-ear corners + keyboard ←/→ flip between dates with
 * a soft page-turn cross-fade. The current date lives at module scope.
 *
 * Live updates: subscribes to bus events through `window.digest.onUpdate`.
 * On any `diary.*` or `task.*` event, re-fetches and re-paints the CURRENT
 * date (so viewing a past page doesn't get yanked back to today).
 *
 * Architecture: design/02-diary-model.md + design/11-backend-architecture.md
 * § "Subsystem 8: renderer".
 */

import './frame.css';
import type { Diary, DiaryComponent } from '@shared/types/diary.js';
import { templateFor, type TemplateDeps } from './templates/index.js';
import { prepareCitations, citations, type ArtifactLookup } from './citations.js';
import { drawGlyph, staggerMount } from './motion.js';

// SVG illustrations imported as text (esbuild loader: '.svg': 'text').
import headerOrnament from './illustrations/header-ornament.svg';
import dividerOrnament from './illustrations/divider-ornament.svg';
import dividerVine from './illustrations/divider-vine.svg';
import dividerRule from './illustrations/divider-rule.svg';
import dividerQuiet from './illustrations/divider-quiet.svg';
import glyphActed from './illustrations/marginalia-acted.svg';
import glyphClosed from './illustrations/marginalia-closed.svg';
import glyphDismissed from './illustrations/marginalia-dismissed.svg';
import cornerPrev from './illustrations/corner-prev.svg';
import cornerNext from './illustrations/corner-next.svg';

/**
 * Per-section render specs. Sections are agent-chosen strings; this map holds
 * the rendering preferences for the conventions the agent draws from. Unknown
 * section labels still render — they fall back to a humanized title + the
 * default `dividerRule`.
 */
const SECTION_SPECS: Record<string, { title: string; divider: string }> = {
  // brief / rubric vocabulary
  if_one_thing: { title: 'if there is one thing', divider: dividerOrnament },
  urgent_todo: { title: 'urgent today', divider: dividerOrnament },
  decisions_approvals: { title: 'decisions & approvals', divider: dividerVine },
  team_pulse: { title: 'team & product pulse', divider: dividerRule },
  calendar_personal: { title: 'calendar & personal', divider: dividerRule },
  ai_industry_news: { title: 'industry news', divider: dividerQuiet },
  // legacy time-horizon vocabulary (kept for back-compat — old rows still render)
  right_now: { title: 'right now', divider: dividerOrnament },
  on_the_desk: { title: 'on the desk', divider: dividerVine },
  tracking: { title: 'tracking', divider: dividerRule },
  background: { title: 'background', divider: dividerQuiet },
};

const SECTION_ORDER: string[] = [
  'if_one_thing',
  'urgent_todo',
  'decisions_approvals',
  'team_pulse',
  'calendar_personal',
  'ai_industry_news',
  'right_now',
  'on_the_desk',
  'tracking',
  'background',
];

function humanizeSectionLabel(id: string): string {
  return id.replace(/[_-]+/g, ' ').toLowerCase();
}

function sectionsToRender(
  diary: { sections: Record<string, unknown[]> },
): Array<{ id: string; title: string; divider: string }> {
  const present = Object.keys(diary.sections);
  // Render known sections in conventional order first; trailing unknown
  // sections in the order they appear in the diary payload.
  const ordered = SECTION_ORDER.filter((id) => present.includes(id));
  const extras = present.filter((id) => !SECTION_ORDER.includes(id));
  return [...ordered, ...extras].map((id) => {
    const spec = SECTION_SPECS[id];
    return {
      id,
      title: spec?.title ?? humanizeSectionLabel(id),
      divider: spec?.divider ?? dividerRule,
    };
  });
}

const STATUS_GLYPHS: Record<string, string> = {
  acted: glyphActed,
  closed: glyphClosed,
  dismissed: glyphDismissed,
};

const root = document.getElementById('root')!;

/** Module-scoped page state — the currently-rendered diary date (YYYY-MM-DD). */
let currentDate: string | null = null;
/** Guard against overlapping page flips (rapid arrow-key presses). */
let turning = false;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD by delta days (+/-) and return YYYY-MM-DD. */
function shiftDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function formatDate(iso: string): { weekday: string; rest: string } {
  // Avoid timezone surprises by parsing as Y-M-D.
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
  const rest = date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return { weekday, rest };
}

function renderComponent(component: DiaryComponent, deps: TemplateDeps): HTMLElement {
  const wrap = document.createElement('article');
  wrap.className = 'component';
  wrap.dataset['status'] = component.status;
  wrap.dataset['id'] = component.id;

  const marg = document.createElement('div');
  marg.className = 'component__marginalia';
  if (STATUS_GLYPHS[component.status]) {
    marg.innerHTML = STATUS_GLYPHS[component.status]!;
  }
  wrap.appendChild(marg);

  const body = document.createElement('div');
  body.className = 'component__body-host';
  templateFor(component.template_id)(component, body, deps);
  // Inline source citations beneath the template's content, before the
  // comments block. Renderer falls back to a kind label if the lookup misses.
  const citationsEl = citations(component, deps.artifactLookup ?? {});
  if (citationsEl) body.appendChild(citationsEl);
  wrap.appendChild(body);

  const comments = document.createElement('div');
  comments.className = 'comments';
  for (const c of component.comments) {
    const line = document.createElement('p');
    line.className = 'comment';
    const author = document.createElement('span');
    author.className = 'comment__author';
    author.textContent = 'me ·';
    line.appendChild(author);
    line.appendChild(document.createTextNode(c.text));
    comments.appendChild(line);
  }

  const form = document.createElement('form');
  form.className = 'comment-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'jot a thought…';
  input.setAttribute('aria-label', 'add a comment');
  form.appendChild(input);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    try {
      await deps.addComment(component.id, text);
      input.value = '';
    } catch (err) {
      console.error('[diary] addComment failed:', err);
    }
  });
  comments.appendChild(form);
  wrap.appendChild(comments);

  return wrap;
}

function renderSection(
  spec: { id: string; title: string; divider: string },
  components: DiaryComponent[] | undefined,
  deps: TemplateDeps,
): HTMLElement | null {
  if (!components || components.length === 0) return null;
  const section = document.createElement('section');
  section.className = `section section--${spec.id.replace(/_/g, '-')}`;

  const title = document.createElement('h2');
  title.className = 'section__title';
  title.textContent = spec.title;
  section.appendChild(title);

  for (const comp of components) {
    section.appendChild(renderComponent(comp, deps));
  }

  const dividerWrap = document.createElement('div');
  dividerWrap.className = 'section__divider';
  dividerWrap.innerHTML = spec.divider;
  section.appendChild(dividerWrap);

  return section;
}

function renderMasthead(date: string): HTMLElement {
  const head = document.createElement('header');
  head.className = 'masthead';
  const { weekday, rest } = formatDate(date);

  // Weekday in handwriting on its own line above the formal date.
  const w = document.createElement('p');
  w.className = 'masthead__weekday';
  w.textContent = weekday;
  head.appendChild(w);

  const h = document.createElement('h1');
  h.className = 'masthead__date';
  h.textContent = rest;
  head.appendChild(h);

  const orn = document.createElement('div');
  orn.className = 'masthead__ornament';
  orn.innerHTML = headerOrnament;
  head.appendChild(orn);

  return head;
}

function renderNotes(diary: Diary): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'notes';
  const title = document.createElement('h2');
  title.className = 'notes__title';
  title.textContent = 'notes';
  wrap.appendChild(title);
  for (const note of diary.notes) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = note.text;
    wrap.appendChild(p);
  }
  const form = document.createElement('form');
  form.className = 'note-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'leave a note for tomorrow…';
  input.setAttribute('aria-label', 'add a note');
  form.appendChild(input);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    try {
      await window.digest.addNote(text, diary.date);
      input.value = '';
    } catch (err) {
      console.error('[diary] addNote failed:', err);
    }
  });
  wrap.appendChild(form);
  return wrap;
}

function renderPageCorners(): { prev: HTMLButtonElement; next: HTMLButtonElement } {
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'page-corner page-corner--prev';
  prev.setAttribute('aria-label', 'Previous page');
  prev.innerHTML = cornerPrev;
  const prevLabel = document.createElement('span');
  prevLabel.className = 'page-corner__label';
  prev.appendChild(prevLabel);
  prev.addEventListener('click', () => void navigate(-1));

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'page-corner page-corner--next';
  next.setAttribute('aria-label', 'Next page');
  next.innerHTML = cornerNext;
  const nextLabel = document.createElement('span');
  nextLabel.className = 'page-corner__label';
  next.appendChild(nextLabel);
  next.addEventListener('click', () => void navigate(1));

  return { prev, next };
}

/** Update the hover-tooltip labels on the corners to show the destination date. */
function refreshCornerLabels(date: string): void {
  const prev = root.querySelector<HTMLElement>('.page-corner--prev .page-corner__label');
  const next = root.querySelector<HTMLElement>('.page-corner--next .page-corner__label');
  if (prev) prev.textContent = formatShortDate(shiftDate(date, -1));
  if (next) next.textContent = formatShortDate(shiftDate(date, 1));
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

async function paint(date?: string, opts: { animate?: 'forward' | 'back' | null } = {}): Promise<void> {
  const diary = await window.digest.getDiary(date);
  currentDate = diary.date;

  // Resolve every supporting_artifact_id referenced in the page in one
  // batched IPC call. Citations render inline on each component beneath
  // rationale + content.
  let artifactLookup: ArtifactLookup = {};
  try {
    artifactLookup = await prepareCitations(diary, (ids) =>
      window.digest.lookupArtifacts(ids),
    );
  } catch (err) {
    console.warn('[diary] artifact lookup failed; rendering without citations', err);
  }

  const deps: TemplateDeps = {
    fireTask: (req) => window.digest.fireTask(req),
    addComment: (id, text) => window.digest.addComment(id, text),
    artifactLookup,
  };

  if (opts.animate === 'forward') {
    root.classList.remove('is-turning--back');
    root.classList.remove('is-turning');
    // Force reflow so re-adding the class restarts the animation.
    void root.offsetWidth;
    root.classList.add('is-turning');
  } else if (opts.animate === 'back') {
    root.classList.remove('is-turning');
    root.classList.remove('is-turning--back');
    void root.offsetWidth;
    root.classList.add('is-turning--back');
    root.classList.add('is-turning');
  }

  root.replaceChildren();

  // Page corners — always rendered, even on the empty-state page.
  const { prev, next } = renderPageCorners();
  root.appendChild(prev);
  root.appendChild(next);

  root.appendChild(renderMasthead(diary.date));

  const totalComponents = Object.values(diary.sections).reduce(
    (a, list) => a + list.length,
    0,
  );

  if (totalComponents === 0 && diary.notes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'This page is blank.';
    root.appendChild(empty);
  } else {
    for (const spec of sectionsToRender(diary)) {
      const section = renderSection(spec, diary.sections[spec.id], deps);
      if (section) root.appendChild(section);
    }
    root.appendChild(renderNotes(diary));

    const mounted = Array.from(root.querySelectorAll<HTMLElement>('.component'));
    staggerMount(mounted);

    for (const el of mounted) {
      if (el.dataset['status'] && el.dataset['status'] !== 'open') {
        const marg = el.querySelector<HTMLElement>('.component__marginalia');
        if (marg) drawGlyph(marg, 0);
      }
    }
  }

  refreshCornerLabels(currentDate);
}

async function navigate(deltaDays: number): Promise<void> {
  if (turning) return;
  const base = currentDate ?? todayIso();
  const target = shiftDate(base, deltaDays);
  turning = true;
  try {
    await paint(target, { animate: deltaDays > 0 ? 'forward' : 'back' });
  } catch (err) {
    console.error('[diary] navigate failed:', err);
  } finally {
    // Clear the animation class after the keyframes finish so a subsequent
    // turn can re-trigger them. The animation duration is 420ms.
    setTimeout(() => {
      root.classList.remove('is-turning');
      root.classList.remove('is-turning--back');
      turning = false;
    }, 440);
  }
}

// ─── Keyboard navigation ────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  // Ignore if the user is typing in an input/textarea.
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    void navigate(-1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    void navigate(1);
  }
});

// ─── Bootstrap ───────────────────────────────────────────────────────────

paint().catch((err) => {
  console.error('[diary] initial paint failed:', err);
  const errEl = document.createElement('p');
  errEl.className = 'empty';
  errEl.textContent = `Failed to load diary: ${err instanceof Error ? err.message : String(err)}`;
  root.appendChild(errEl);
});

// Subscribe to live updates. Repaint the currently-viewed date (NOT today)
// so navigating to a past page doesn't get yanked back when fresh events fire.
window.digest.onUpdate((msg) => {
  if (
    msg.kind === 'diary.comment.added' ||
    msg.kind === 'diary.note.added' ||
    msg.kind === 'diary.invocation.done' ||
    msg.kind === 'task.fired' ||
    msg.kind === 'task.completed' ||
    msg.kind === 'task.failed'
  ) {
    paint(currentDate ?? undefined).catch((err) =>
      console.error('[diary] live repaint failed:', err),
    );
  }
});

// Refresh-on-show: every time main toggles the diary window visible, repaint
// for today. The user clicked "Today's diary" — they expect today, even if
// they last navigated to a past page or the app has been running across a
// midnight rollover.
window.digest.onDiaryShow(({ today }) => {
  if (today === currentDate) return;
  paint(today).catch((err) =>
    console.error('[diary] refresh-on-show paint failed:', err),
  );
});
