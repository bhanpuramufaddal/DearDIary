/**
 * Citation rendering.
 *
 * Each diary component carries `supporting_artifact_ids: string[]` — source
 * ids (e.g. `gmail:<msg-id>`, `gcal:<event-uid>`) for every claim it makes.
 * `prepareCitations(diary)` resolves them all in one IPC round-trip;
 * `citations(ids, lookup)` returns a DOM element that renders the markers
 * inline beneath rationale + content.
 *
 * The rendered shape mirrors the trial brief's sample:
 *   *[email: Marcus, May 19 16:42]*
 *
 * Unresolved ids (no matching event in the substrate) fall back to a kind
 * label parsed from the prefix.
 */

import type { Diary, DiaryComponent } from '@shared/types/diary.js';

export type ArtifactLookup = Record<
  string,
  { kind: string; attribution: string; date: string }
>;

type LookupFn = (sourceIds: string[]) => Promise<ArtifactLookup>;

/**
 * Collect every source id referenced by every component in the diary, fetch
 * the labels in one batch. Returns a lookup map keyed by source_id.
 */
export async function prepareCitations(
  diary: Diary,
  lookup: LookupFn,
): Promise<ArtifactLookup> {
  const ids = new Set<string>();
  for (const componentList of Object.values(diary.sections)) {
    for (const c of componentList) {
      if (c.supporting_artifact_ids) {
        for (const id of c.supporting_artifact_ids) ids.add(id);
      }
    }
  }
  if (ids.size === 0) return {};
  return lookup(Array.from(ids));
}

function fallbackLabel(sourceId: string): { kind: string; attribution: string; date: string } {
  const prefix = sourceId.split(':')[0] ?? '';
  const kindLabel: Record<string, string> = {
    gmail: 'email',
    persona: 'email',
    gcal: 'cal',
    notion: 'note',
    slack: 'slack',
  };
  const kind = kindLabel[prefix] ?? prefix ?? 'source';
  const tail = sourceId.replace(/^[^:]+:/, '').slice(-40);
  return { kind, attribution: tail, date: '' };
}

function formatMarker(id: string, lookup: ArtifactLookup): string {
  const hit = lookup[id] ?? fallbackLabel(id);
  const parts = [hit.kind, hit.attribution, hit.date]
    .filter((s) => s && s.length > 0)
    .join(': '.length === 0 ? ' ' : ''); // placeholder; assembled below.
  // Compose: `kind: attribution, date` (drop empties).
  const left = hit.attribution ? `${hit.kind}: ${hit.attribution}` : hit.kind;
  return hit.date ? `[${left}, ${hit.date}]` : `[${left}]`;
  void parts; // silence unused (computed above as readability scratch).
}

/**
 * Render the inline citations row for a component. Returns `null` if there
 * are no ids to render.
 */
export function citations(
  component: DiaryComponent,
  lookup: ArtifactLookup,
): HTMLElement | null {
  const ids = component.supporting_artifact_ids ?? [];
  if (ids.length === 0) return null;

  const row = document.createElement('div');
  row.className = 'component__citations';
  row.style.fontSize = 'var(--t-small)';
  row.style.opacity = '0.6';
  row.style.marginTop = '6px';
  row.style.fontStyle = 'italic';

  const text = ids.map((id) => formatMarker(id, lookup)).join(' ');
  row.textContent = text;
  return row;
}
