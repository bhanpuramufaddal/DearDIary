#!/usr/bin/env node
/**
 * eval-digest.ts — score a produced diary against the persona-generator's
 * ideal-digest ground truth.
 *
 * For each day, the produced diary's components and the ideal digest's items
 * are handed to an LLM judge, which returns a bipartite mapping (which diary
 * item refers to the same real-world matter as which ideal item) plus any
 * suppression violations (diary items that surfaced something on the
 * expected_suppressions list). Code then computes precision / recall /
 * cardinality breakdown deterministically from the judge's edges.
 *
 *   precision = diary items that map to >=1 ideal item  / total diary items
 *   recall    = ideal items covered by >=1 diary item   / total ideal items
 *
 * Usage:
 *   npm run eval                                    # all overlapping dates, default persona
 *   npm run eval -- --persona avery_chen --from 2026-05-14 --to 2026-05-19
 *   npm run eval -- --dates 2026-05-15
 *   npm run eval -- --out /tmp/eval-report.json
 *
 * Reads the produced diary from <digest-db> via the `sqlite3` CLI in JSON
 * mode (no better-sqlite3 native module needed). Reads ideal digests from
 * <repo>/../data/personas/<slug>/ideal_digests/. Calls the Anthropic API
 * directly (ANTHROPIC_API_KEY from env; npm script passes --env-file).
 */

import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ─── types ────────────────────────────────────────────────────────────────

interface Args {
  persona: string;
  db: string;
  from?: string;
  to?: string;
  dates?: string[];
  model: string;
  out?: string;
  skipEmptyDiary?: boolean;
  help?: boolean;
}

interface DiaryItem {
  ref: string; // component id
  section: string;
  template_id: string;
  headline: string;
  rationale: string;
  content: string; // stringified JSON
  cited: string[];
}

interface IdealItem {
  ref: string; // moment_id
  storyline_id: string;
  section: string;
  priority: string;
  action_class: string;
  rationale: string;
  cited: string[];
}

interface Suppression {
  ref: string; // artifact_id
  reason: string;
}

interface Edge {
  diary_ref: string;
  ideal_ref: string;
  reason: string;
}

interface SuppressionHit {
  diary_ref: string;
  suppression_ref: string;
  reason: string;
}

interface CardinalityBreakdown {
  one_to_one: number;
  one_to_many: number;
  many_to_one: number;
  many_to_many: number;
  diary_only: number; // false positives — surfaced, no ideal match
  ideal_only: number; // misses — ideal item nothing covered
}

interface DayReport {
  date: string;
  ideal_file: string | null;
  diary_count: number;
  ideal_count: number;
  suppression_count: number;
  precision: number | null; // null when diary empty
  recall: number | null; // null when ideal empty
  mapped_diary: number;
  mapped_ideal: number;
  suppression_violations: number;
  cardinality: CardinalityBreakdown;
  edges: Edge[];
  suppression_hits: SuppressionHit[];
}

// ─── arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Args {
  const out: Args = {
    persona: 'avery_chen',
    db: '',
    // Opus by default: the judge's accuracy is the eval's accuracy. In testing,
    // sonnet forced spurious edges (mapping a Cowboy pro-rata prep to a school-
    // tuition moment), inflating both precision and recall. Opus held the line.
    // Override with --model for a cheaper sweep.
    model: 'claude-opus-4-7',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--persona') out.persona = argv[++i]!;
    else if (a === '--digest-db' || a === '--db') out.db = argv[++i]!;
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--dates') out.dates = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--model') out.model = argv[++i]!;
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--skip-empty-diary') out.skipEmptyDiary = true;
  }
  if (!out.db) {
    const digestDir = process.env['DIGEST_DIR'] ?? '/tmp/avery-sandbox';
    out.db = join(digestDir, 'digest.db');
  }
  return out;
}

// ─── produced diary read (via sqlite3 CLI, JSON mode) ────────────────────────

function sqliteJson(db: string, query: string): Record<string, unknown>[] {
  const raw = execFileSync('sqlite3', ['-json', db, query], { encoding: 'utf-8' }).trim();
  if (!raw) return [];
  return JSON.parse(raw) as Record<string, unknown>[];
}

function producedDates(db: string): string[] {
  const rows = sqliteJson(
    db,
    'SELECT DISTINCT diary_date FROM diary_components ORDER BY diary_date',
  );
  return rows.map((r) => String(r['diary_date']));
}

function readProducedDiary(db: string, date: string): DiaryItem[] {
  const rows = sqliteJson(
    db,
    `SELECT id, section, template_id, COALESCE(headline,'') AS headline,
            COALESCE(rationale,'') AS rationale, content,
            COALESCE(supporting_artifact_ids,'[]') AS supporting_artifact_ids
       FROM diary_components
      WHERE diary_date = '${date}'
      ORDER BY position ASC`,
  );
  return rows.map((r) => ({
    ref: String(r['id']),
    section: String(r['section']),
    template_id: String(r['template_id']),
    headline: String(r['headline']),
    rationale: String(r['rationale']),
    content: String(r['content'] ?? '{}'),
    cited: safeJsonArray(String(r['supporting_artifact_ids'] ?? '[]')),
  }));
}

function safeJsonArray(s: string): string[] {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ─── ideal digest load (by for_date) ─────────────────────────────────────────

function idealDir(persona: string): string {
  return resolve(REPO_ROOT, '..', 'data', 'personas', persona, 'ideal_digests');
}

interface IdealDigest {
  file: string;
  items: IdealItem[];
  suppressions: Suppression[];
}

/** Index every ideal_digests file by its `for_date`. */
function loadIdealIndex(persona: string): Map<string, IdealDigest> {
  const dir = idealDir(persona);
  const index = new Map<string, IdealDigest>();
  if (!existsSync(dir)) return index;
  for (const fname of readdirSync(dir)) {
    if (!fname.endsWith('.json')) continue;
    const parsed = JSON.parse(readFileSync(join(dir, fname), 'utf-8')) as {
      for_date?: string;
      items?: Array<Record<string, unknown>>;
      expected_suppressions?: Array<Record<string, unknown>>;
    };
    if (!parsed.for_date) continue;
    index.set(parsed.for_date, {
      file: fname,
      items: (parsed.items ?? []).map((i) => ({
        ref: String(i['moment_id']),
        storyline_id: String(i['storyline_id'] ?? ''),
        section: String(i['section'] ?? ''),
        priority: String(i['priority'] ?? ''),
        action_class: String(i['action_class'] ?? ''),
        rationale: String(i['rationale'] ?? ''),
        cited: Array.isArray(i['supporting_artifact_ids'])
          ? (i['supporting_artifact_ids'] as unknown[]).map(String)
          : [],
      })),
      suppressions: (parsed.expected_suppressions ?? []).map((s) => ({
        ref: String(s['artifact_id']),
        reason: String(s['rationale'] ?? ''),
      })),
    });
  }
  return index;
}

// ─── LLM judge ────────────────────────────────────────────────────────────

const MAPPING_TOOL: Anthropic.Tool = {
  name: 'report_mapping',
  description:
    'Report the bipartite mapping between produced diary items and ideal-digest items, plus any suppression violations.',
  input_schema: {
    type: 'object',
    properties: {
      edges: {
        type: 'array',
        description:
          'One entry per (diary item, ideal item) pair that refer to the SAME underlying real-world matter. A diary item may appear in multiple edges (it covers multiple ideal moments) and an ideal item may appear in multiple edges (it was split across diary components).',
        items: {
          type: 'object',
          properties: {
            diary_ref: { type: 'string', description: 'The diary item ref.' },
            ideal_ref: { type: 'string', description: 'The ideal item ref (moment_id).' },
            reason: { type: 'string', description: 'One sentence: why these are the same matter.' },
          },
          required: ['diary_ref', 'ideal_ref', 'reason'],
        },
      },
      suppression_hits: {
        type: 'array',
        description:
          'Diary items that surfaced something the ideal digest explicitly marked for suppression.',
        items: {
          type: 'object',
          properties: {
            diary_ref: { type: 'string' },
            suppression_ref: { type: 'string', description: 'The expected_suppressions artifact_id.' },
            reason: { type: 'string' },
          },
          required: ['diary_ref', 'suppression_ref', 'reason'],
        },
      },
    },
    required: ['edges', 'suppression_hits'],
  },
};

function buildJudgePrompt(
  date: string,
  diary: DiaryItem[],
  ideal: IdealItem[],
  suppressions: Suppression[],
): string {
  const diaryBlock = diary
    .map(
      (d) =>
        `- ref: ${d.ref}\n  section: ${d.section}\n  template: ${d.template_id}\n  headline: ${d.headline}\n  rationale: ${d.rationale}\n  content: ${truncate(d.content, 600)}\n  cited: ${d.cited.join(', ') || '(none)'}`,
    )
    .join('\n');
  const idealBlock = ideal
    .map(
      (i) =>
        `- ref: ${i.ref}\n  section: ${i.section}  priority: ${i.priority}  action_class: ${i.action_class}\n  rationale: ${i.rationale}\n  cited: ${i.cited.join(', ') || '(none)'}`,
    )
    .join('\n');
  const suppBlock = suppressions
    .map((s) => `- ref: ${s.ref}\n  reason: ${s.reason}`)
    .join('\n');

  return [
    `You are evaluating a daily digest for ${date} against ground truth.`,
    '',
    'You are given:',
    '1. PRODUCED ITEMS — what the digest actually surfaced (one per diary component).',
    '2. IDEAL ITEMS — what an ideal digest should have surfaced (ground truth).',
    '3. SUPPRESSIONS — things that should NOT appear (noise / decoys).',
    '',
    'Your job: map produced items to ideal items by the underlying REAL-WORLD MATTER — a specific reply owed, a specific decision, a specific meeting, a specific signal. Map on substance, not wording. A produced item that bundles two ideal matters maps to BOTH; an ideal matter split across two produced items gets an edge from each. Shared artifact-id stems are a hint, but the produced item\'s citations may be imperfect — rely on the rationale/headline/content meaning.',
    '',
    'Also flag any produced item that surfaced something on the SUPPRESSIONS list (a discipline failure).',
    '',
    'Only emit an edge when you are confident the two describe the same matter. A produced item that corresponds to no ideal item simply gets no edge (it is a false positive). An ideal item that no produced item covers gets no edge (it is a miss).',
    '',
    '=== PRODUCED ITEMS ===',
    diaryBlock || '(none — the digest was empty this day)',
    '',
    '=== IDEAL ITEMS ===',
    idealBlock || '(none — nothing should have been surfaced this day)',
    '',
    '=== SUPPRESSIONS ===',
    suppBlock || '(none)',
    '',
    'Call report_mapping with your edges and suppression_hits.',
  ].join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function judgeMapping(
  client: Anthropic,
  model: string,
  date: string,
  diary: DiaryItem[],
  ideal: IdealItem[],
  suppressions: Suppression[],
): Promise<{ edges: Edge[]; suppression_hits: SuppressionHit[] }> {
  // No work to do if either side is empty AND there are no suppressions to check.
  if (diary.length === 0) return { edges: [], suppression_hits: [] };
  if (ideal.length === 0 && suppressions.length === 0) return { edges: [], suppression_hits: [] };

  const resp = await client.messages.create({
    model,
    max_tokens: 4096,
    tools: [MAPPING_TOOL],
    tool_choice: { type: 'tool', name: 'report_mapping' },
    messages: [{ role: 'user', content: buildJudgePrompt(date, diary, ideal, suppressions) }],
  });
  const toolUse = resp.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`judge for ${date} returned no tool_use block`);
  }
  const input = toolUse.input as { edges?: Edge[]; suppression_hits?: SuppressionHit[] };
  // Defensively drop edges that reference refs not actually present (LLM slip).
  const diaryRefs = new Set(diary.map((d) => d.ref));
  const idealRefs = new Set(ideal.map((i) => i.ref));
  const suppRefs = new Set(suppressions.map((s) => s.ref));
  const edges = (input.edges ?? []).filter(
    (e) => diaryRefs.has(e.diary_ref) && idealRefs.has(e.ideal_ref),
  );
  const suppression_hits = (input.suppression_hits ?? []).filter(
    (h) => diaryRefs.has(h.diary_ref) && suppRefs.has(h.suppression_ref),
  );
  return { edges, suppression_hits };
}

// ─── metric computation ─────────────────────────────────────────────────────

function cardinalityBreakdown(
  diary: DiaryItem[],
  ideal: IdealItem[],
  edges: Edge[],
): CardinalityBreakdown {
  // Union-find over the bipartite graph (namespace nodes to avoid id collisions).
  const node = (side: 'd' | 'i', ref: string): string => `${side}:${ref}`;
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const ensure = (x: string): void => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string): void => {
    ensure(a);
    ensure(b);
    parent.set(find(a), find(b));
  };

  for (const d of diary) ensure(node('d', d.ref));
  for (const i of ideal) ensure(node('i', i.ref));
  for (const e of edges) union(node('d', e.diary_ref), node('i', e.ideal_ref));

  // Group nodes by component root, count diary vs ideal nodes per component.
  const comp = new Map<string, { d: number; i: number }>();
  const tally = (key: string, side: 'd' | 'i'): void => {
    const root = find(key);
    const c = comp.get(root) ?? { d: 0, i: 0 };
    c[side] += 1;
    comp.set(root, c);
  };
  for (const d of diary) tally(node('d', d.ref), 'd');
  for (const i of ideal) tally(node('i', i.ref), 'i');

  const b: CardinalityBreakdown = {
    one_to_one: 0,
    one_to_many: 0,
    many_to_one: 0,
    many_to_many: 0,
    diary_only: 0,
    ideal_only: 0,
  };
  for (const { d, i } of comp.values()) {
    if (d > 0 && i === 0) b.diary_only += 1;
    else if (d === 0 && i > 0) b.ideal_only += 1;
    else if (d === 1 && i === 1) b.one_to_one += 1;
    else if (d === 1 && i > 1) b.one_to_many += 1;
    else if (d > 1 && i === 1) b.many_to_one += 1;
    else b.many_to_many += 1;
  }
  return b;
}

function computeDayReport(
  date: string,
  idealFile: string | null,
  diary: DiaryItem[],
  ideal: IdealItem[],
  suppressions: Suppression[],
  edges: Edge[],
  suppression_hits: SuppressionHit[],
): DayReport {
  const mappedDiary = new Set(edges.map((e) => e.diary_ref));
  const mappedIdeal = new Set(edges.map((e) => e.ideal_ref));
  const suppressionViolations = new Set(suppression_hits.map((h) => h.diary_ref));
  return {
    date,
    ideal_file: idealFile,
    diary_count: diary.length,
    ideal_count: ideal.length,
    suppression_count: suppressions.length,
    precision: diary.length === 0 ? null : mappedDiary.size / diary.length,
    recall: ideal.length === 0 ? null : mappedIdeal.size / ideal.length,
    mapped_diary: mappedDiary.size,
    mapped_ideal: mappedIdeal.size,
    suppression_violations: suppressionViolations.size,
    cardinality: cardinalityBreakdown(diary, ideal, edges),
    edges,
    suppression_hits,
  };
}

// ─── reporting ──────────────────────────────────────────────────────────────

function fmtPct(v: number | null): string {
  return v === null ? '  —  ' : `${(v * 100).toFixed(0).padStart(3)}%`;
}

function printReport(days: DayReport[]): void {
  console.log('');
  console.log(
    'date        | diary | ideal | prec | recall | supp✗ | cardinality (1:1/1:N/N:1/N:N | FP/miss)',
  );
  console.log(
    '------------+-------+-------+------+--------+-------+----------------------------------------',
  );
  for (const d of days) {
    const c = d.cardinality;
    const card = `${c.one_to_one}/${c.one_to_many}/${c.many_to_one}/${c.many_to_many} | ${c.diary_only}/${c.ideal_only}`;
    console.log(
      `${d.date} | ${String(d.diary_count).padStart(5)} | ${String(d.ideal_count).padStart(5)} | ${fmtPct(d.precision)} | ${fmtPct(d.recall).padStart(6)} | ${String(d.suppression_violations).padStart(5)} | ${card}`,
    );
  }

  // Micro-averages (only over days where the relevant side is non-empty).
  let mappedD = 0,
    totD = 0,
    mappedI = 0,
    totI = 0,
    suppV = 0;
  for (const d of days) {
    if (d.diary_count > 0) {
      mappedD += d.mapped_diary;
      totD += d.diary_count;
    }
    if (d.ideal_count > 0) {
      mappedI += d.mapped_ideal;
      totI += d.ideal_count;
    }
    suppV += d.suppression_violations;
  }
  console.log(
    '------------+-------+-------+------+--------+-------+----------------------------------------',
  );
  const microP = totD === 0 ? null : mappedD / totD;
  const microR = totI === 0 ? null : mappedI / totI;
  console.log(
    `AGGREGATE: micro-precision ${fmtPct(microP)} (${mappedD}/${totD})   micro-recall ${fmtPct(microR)} (${mappedI}/${totI})   suppression-violations ${suppV}`,
  );
  console.log('');
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'usage: npm run eval -- [--persona <slug>] [--digest-db <path>] [--from D --to D | --dates a,b] [--model <id>] [--out <path>]',
    );
    return;
  }
  if (!existsSync(args.db)) {
    console.error(`digest DB not found: ${args.db}`);
    process.exit(1);
  }
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('ANTHROPIC_API_KEY not set (npm run eval passes --env-file=.env.testmode).');
    process.exit(1);
  }

  const idealIndex = loadIdealIndex(args.persona);
  if (idealIndex.size === 0) {
    console.error(`no ideal digests found in ${idealDir(args.persona)}`);
    process.exit(1);
  }

  // Determine the date set: explicit, or every ideal date within the produced
  // run's window. We span [min, max] produced diary_date (NOT the intersection)
  // so that days the diary should have covered but left empty — e.g. a diary
  // invocation that timed out and wrote nothing — still count as recall=0
  // misses rather than silently dropping out of the eval.
  let dates: string[];
  if (args.dates && args.dates.length) {
    dates = args.dates;
  } else {
    const produced = producedDates(args.db).sort();
    if (produced.length === 0) {
      console.error('no produced diary components in the DB.');
      process.exit(1);
    }
    const lo = args.from ?? produced[0]!;
    const hi = args.to ?? produced[produced.length - 1]!;
    dates = [...idealIndex.keys()].filter((d) => d >= lo && d <= hi).sort();
  }
  if (dates.length === 0) {
    console.error('no overlapping dates between produced diary and ideal digests.');
    process.exit(1);
  }

  console.log(
    `Evaluating ${dates.length} day(s) for ${args.persona} — db ${args.db}, model ${args.model}`,
  );

  const client = new Anthropic();
  const reports: DayReport[] = [];
  let skipped = 0;
  for (const date of dates) {
    const diary = readProducedDiary(args.db, date);
    // --skip-empty-diary: drop days where the diary produced nothing (e.g. a
    // diary invocation that timed out). These are excluded from the metrics
    // entirely rather than counted as recall=0 misses.
    if (args.skipEmptyDiary && diary.length === 0) {
      skipped += 1;
      console.log(`  skipping ${date} (empty diary)`);
      continue;
    }
    const ideal = idealIndex.get(date);
    const idealItems = ideal?.items ?? [];
    const suppressions = ideal?.suppressions ?? [];
    process.stdout.write(`  judging ${date} (diary ${diary.length}, ideal ${idealItems.length})… `);
    const { edges, suppression_hits } = await judgeMapping(
      client,
      args.model,
      date,
      diary,
      idealItems,
      suppressions,
    );
    const report = computeDayReport(
      date,
      ideal?.file ?? null,
      diary,
      idealItems,
      suppressions,
      edges,
      suppression_hits,
    );
    reports.push(report);
    console.log(
      `prec ${fmtPct(report.precision).trim()} recall ${fmtPct(report.recall).trim()} supp✗ ${report.suppression_violations}`,
    );
  }

  if (skipped > 0) {
    console.log(`(excluded ${skipped} empty-diary day(s) via --skip-empty-diary)`);
  }
  printReport(reports);

  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ persona: args.persona, db: args.db, model: args.model, days: reports }, null, 2));
    console.log(`Full report written to ${args.out}`);
  }
}

main().catch((err: unknown) => {
  console.error('[eval-digest] fatal:', err);
  process.exit(1);
});
