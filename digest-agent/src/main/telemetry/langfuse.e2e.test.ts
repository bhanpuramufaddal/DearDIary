/**
 * End-to-end Langfuse round-trip — real cloud, mocked LLM.
 *
 * What this verifies:
 *   - The Langfuse SDK initializes against real credentials.
 *   - `tracer.startActiveSpan(...)` creates a span that flushes through
 *     `LangfuseSpanProcessor` to the Langfuse OTLP endpoint.
 *   - Nested child spans (simulating the spans Claude Code's native OTel
 *     would emit — `claude_code.interaction` / `claude_code.llm_request` /
 *     `claude_code.tool`) round-trip with correct parent/child structure.
 *   - The Langfuse public API returns the trace by its OTel `trace_id`, with
 *     our attributes preserved on the parent and observations populated.
 *
 * What we mock: the LLM. We are NOT spawning Claude Code — we open the
 * child spans by hand to simulate the shape its OTel export would produce.
 *
 * Skips when LANGFUSE_PUBLIC_KEY isn't set, so `npm test` stays green for
 * dev machines without Langfuse creds. When creds ARE set, it makes real
 * network calls to Langfuse cloud (or whatever LANGFUSE_BASE_URL points at).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { trace } from '@opentelemetry/api';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import {
  initLangfuse,
  shutdownLangfuse,
  flushLangfuse,
  currentTraceparent,
  isLangfuseInitialized,
  setLangfuseTraceContext,
  setLangfuseTraceOutput,
} from './langfuse.js';

// Same env-file loading as src/main/index.ts so this test works under
// `npm test` without the caller exporting shell vars first. `override: false`
// keeps any pre-set CI env in precedence.
dotenv.config({ path: resolve('.env'), override: false });
dotenv.config({ path: resolve('..', '.env'), override: false });

const hasCreds = !!process.env['LANGFUSE_PUBLIC_KEY'] && !!process.env['LANGFUSE_SECRET_KEY'];

interface LangfuseTraceResponse {
  id: string;
  name: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown> | null;
  observations?: Array<{ name: string | null; type: string }>;
  // The Langfuse trace endpoint also returns a flat list of attributes from
  // the OTel span; we don't depend on a strict shape — we string-match the
  // serialized response for the values we set.
  [k: string]: unknown;
}

function basicAuthHeader(): string {
  const key = process.env['LANGFUSE_PUBLIC_KEY']!;
  const secret = process.env['LANGFUSE_SECRET_KEY']!;
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
}

function baseUrl(): string {
  return process.env['LANGFUSE_BASE_URL'] || 'https://cloud.langfuse.com';
}

async function fetchTraceById(traceId: string): Promise<LangfuseTraceResponse | null> {
  const res = await fetch(`${baseUrl()}/api/public/traces/${traceId}`, {
    headers: { Authorization: basicAuthHeader() },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`langfuse api ${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as LangfuseTraceResponse;
}

interface LangfuseObservation {
  id: string;
  name: string | null;
  type: string;
  traceId: string;
  parentObservationId?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  model?: string | null;
  usage?: { input?: number; output?: number; total?: number } | null;
  calculatedTotalCost?: number | null;
  [k: string]: unknown;
}

async function fetchObservationsByTraceId(traceId: string): Promise<LangfuseObservation[]> {
  // /api/public/observations supports pagination but we only generate ~4 spans
  // so a single page is plenty. limit=100 is well under their max.
  const url = `${baseUrl()}/api/public/observations?traceId=${traceId}&limit=100`;
  const res = await fetch(url, { headers: { Authorization: basicAuthHeader() } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`langfuse api ${res.status} ${res.statusText}: ${body}`);
  }
  const j = (await res.json()) as { data: LangfuseObservation[] };
  return j.data ?? [];
}

/**
 * Wait until the trace's `/observations` list has at least `minCount` rows.
 * Langfuse ingestion is eventually consistent — the trace endpoint can return
 * 200 a few seconds before all child observations are queryable.
 */
async function waitForObservations(
  traceId: string,
  minCount: number,
  timeoutMs: number,
): Promise<LangfuseObservation[]> {
  const start = Date.now();
  let delay = 500;
  let last: LangfuseObservation[] = [];
  while (Date.now() - start < timeoutMs) {
    try {
      last = await fetchObservationsByTraceId(traceId);
      if (last.length >= minCount) return last;
    } catch {
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.floor(delay * 1.5), 3000);
  }
  throw new Error(
    `Trace ${traceId} only had ${last.length}/${minCount} observations within ${timeoutMs}ms`,
  );
}

async function waitForTrace(traceId: string, timeoutMs: number): Promise<LangfuseTraceResponse> {
  const start = Date.now();
  let delay = 750;
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const t = await fetchTraceById(traceId);
      if (t) return t;
      lastErr = undefined;
    } catch (err) {
      // Transient 5xx during ingestion → keep polling unless we're at the
      // very end of the budget.
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.floor(delay * 1.5), 4000);
  }
  throw new Error(
    `Trace ${traceId} did not appear within ${timeoutMs}ms` +
      (lastErr ? ` (last error: ${(lastErr as Error).message})` : ''),
  );
}

describe.skipIf(!hasCreds)('langfuse e2e — real cloud round-trip', () => {
  // Share one OTel SDK init across both tests. Shutting it down between
  // tests poisons OTel's global tracer provider (the second test's spans
  // never leave the process). Flush between tests instead.
  beforeAll(() => {
    initLangfuse();
    expect(isLangfuseInitialized()).toBe(true);
  });
  afterAll(async () => {
    await shutdownLangfuse();
  });

  it('exhaustive input → output mapping: every documented langfuse.* attribute round-trips to the expected API field', async () => {
    const testRunId = `mapping-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    // Known values we'll send and assert on. Naming is verbose on purpose
    // so a stray match in the JSON dump tells us exactly which attribute
    // landed where.
    const expected = {
      traceName: `tracename_${testRunId}`,
      sessionId: `session_${testRunId}`,
      userId: `userid_${testRunId}`,
      traceInput: { event: 'webhook.persona', payload_id: testRunId },
      traceOutput: { ok: true, marker: testRunId },
      traceMetadata: {
        persona: 'avery_chen',
        day: '2026-05-14',
        marker: testRunId,
      },
      traceTags: ['mind', `tag-${testRunId}`, 'verification'],
      environment: 'e2e-test',
      release: 'v0.1.0',
      // SPAN child
      spanInput: { tool: 'run_sql', sql: 'SELECT 1' },
      spanOutput: { rows: 3, marker: testRunId },
      spanMetadata: { tool_kind: 'mcp', marker: testRunId },
      spanLevel: 'DEBUG',
      spanStatusMessage: `status_${testRunId}`,
      // GENERATION child
      genModel: 'claude-sonnet-4-5',
      genInput: [{ role: 'user', content: `gen-input-${testRunId}` }],
      genOutput: `gen-output-${testRunId}`,
      genUsage: { input: 100, output: 50, total: 150 },
      // EVENT child
      eventInput: `event-input-${testRunId}`,
      eventMetadata: { event_kind: 'milestone', marker: testRunId },
    };

    const tracer = trace.getTracer('digest-agent-e2e-test');
    let parentTraceId: string | undefined;

    await tracer.startActiveSpan('original-span-name', async (parent) => {
      // TRACE-level attributes (set on the root span).
      parent.setAttributes({
        'langfuse.trace.name': expected.traceName,
        'langfuse.session.id': expected.sessionId,
        'langfuse.user.id': expected.userId,
        'langfuse.trace.input': JSON.stringify(expected.traceInput),
        'langfuse.trace.output': JSON.stringify(expected.traceOutput),
        'langfuse.trace.metadata': JSON.stringify(expected.traceMetadata),
        'langfuse.trace.tags': JSON.stringify(expected.traceTags),
        'langfuse.environment': expected.environment,
        'langfuse.release': expected.release,
        // Classify the parent itself as a SPAN observation.
        'langfuse.observation.type': 'span',
      });

      parentTraceId = currentTraceparent()?.split('-')[1];

      // SPAN child — all observation-level attributes set.
      await tracer.startActiveSpan('child-span', (child) => {
        child.setAttributes({
          'langfuse.observation.type': 'span',
          'langfuse.observation.input': JSON.stringify(expected.spanInput),
          'langfuse.observation.output': JSON.stringify(expected.spanOutput),
          'langfuse.observation.metadata': JSON.stringify(expected.spanMetadata),
          'langfuse.observation.level': expected.spanLevel,
          'langfuse.observation.status_message': expected.spanStatusMessage,
        });
        child.end();
      });

      // GENERATION child — langfuse.observation.* + parallel usage_details.
      await tracer.startActiveSpan('child-generation', (gen) => {
        gen.setAttributes({
          'langfuse.observation.type': 'generation',
          'langfuse.observation.model.name': expected.genModel,
          'langfuse.observation.input': JSON.stringify(expected.genInput),
          'langfuse.observation.output': expected.genOutput,
          'langfuse.observation.usage_details': JSON.stringify(expected.genUsage),
        });
        gen.end();
      });

      // EVENT child.
      await tracer.startActiveSpan('child-event', (ev) => {
        ev.setAttributes({
          'langfuse.observation.type': 'event',
          'langfuse.observation.input': expected.eventInput,
          'langfuse.observation.metadata': JSON.stringify(expected.eventMetadata),
        });
        ev.end();
      });

      parent.end();
    });

    expect(parentTraceId).toMatch(/^[0-9a-f]{32}$/);
    await flushLangfuse();

    const fetched = await waitForTrace(parentTraceId!, 60_000);
    // 4 spans = parent + child-span + child-generation + child-event.
    const observations = await waitForObservations(parentTraceId!, 4, 60_000);

    try {
      // ─── TRACE-level mappings ──────────────────────────────────────────
      expect(fetched.name, 'trace.name').toBe(expected.traceName);
      expect(fetched.sessionId, 'trace.sessionId').toBe(expected.sessionId);
      expect((fetched as any).userId, 'trace.userId').toBe(expected.userId);
      expect((fetched as any).input, 'trace.input').toEqual(expected.traceInput);
      expect((fetched as any).output, 'trace.output').toEqual(expected.traceOutput);
      expect(fetched.metadata, 'trace.metadata').toMatchObject(expected.traceMetadata);
      const tags = (fetched as any).tags ?? [];
      for (const t of expected.traceTags) {
        expect(tags, `trace.tags should contain ${t}`).toContain(t);
      }
      expect((fetched as any).environment, 'trace.environment').toBe(expected.environment);
      expect((fetched as any).release, 'trace.release').toBe(expected.release);

      // ─── OBSERVATION-level mappings ────────────────────────────────────
      const byName = Object.fromEntries(observations.map((o) => [o.name, o]));
      expect(byName['child-span'], 'child-span obs missing').toBeTruthy();
      expect(byName['child-span']!.type, 'span.type').toBe('SPAN');
      expect(byName['child-span']!.input, 'span.input').toEqual(expected.spanInput);
      expect(byName['child-span']!.output, 'span.output').toEqual(expected.spanOutput);
      expect(byName['child-span']!.metadata, 'span.metadata').toMatchObject(expected.spanMetadata);
      expect((byName['child-span'] as any).level, 'span.level').toBe(expected.spanLevel);
      expect((byName['child-span'] as any).statusMessage, 'span.statusMessage').toBe(
        expected.spanStatusMessage,
      );

      expect(byName['child-generation']!.type, 'gen.type').toBe('GENERATION');
      expect(byName['child-generation']!.model, 'gen.model').toBe(expected.genModel);
      expect(byName['child-generation']!.usage?.input, 'gen.usage.input').toBe(
        expected.genUsage.input,
      );
      expect(byName['child-generation']!.usage?.output, 'gen.usage.output').toBe(
        expected.genUsage.output,
      );

      expect(byName['child-event']!.type, 'event.type').toBe('EVENT');
      expect((byName['child-event'] as any).metadata, 'event.metadata').toMatchObject(
        expected.eventMetadata,
      );
    } catch (err) {
      // Dump everything we sent vs. everything we got, so iterating on
      // mapping mismatches is fast.

      console.error('[langfuse e2e] EXPECTED:', JSON.stringify(expected, null, 2));

      console.error('[langfuse e2e] TRACE:', JSON.stringify(fetched, null, 2).slice(0, 6000));

      console.error(
        '[langfuse e2e] OBSERVATIONS:',
        JSON.stringify(observations, null, 2).slice(0, 8000),
      );
      throw err;
    }
  }, 120_000);

  it('production-shape: setLangfuseTraceContext / setLangfuseTraceOutput populate the right API fields', async () => {
    initLangfuse();
    expect(isLangfuseInitialized()).toBe(true);

    const testRunId = `prod-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const persona = `persona_${testRunId}`;
    const personaDay = '2026-05-14';
    const invocationId = `inv_${testRunId}`;
    const triggeringKind = 'webhook.persona';
    const input = { kind: triggeringKind, payload: { marker: testRunId } };
    const output = { final: `final_message_${testRunId}` };

    const tracer = trace.getTracer('digest-agent-e2e-test');
    let traceId: string | undefined;

    await tracer.startActiveSpan('agent.invocation.mind', async (span) => {
      setLangfuseTraceContext(span, {
        role: 'mind',
        invocationId,
        personaDay,
        persona,
        triggeringKind,
        input,
      });
      traceId = currentTraceparent()?.split('-')[1];
      // Simulate the LLM happening: produce a gen_ai-attributed child so
      // Langfuse computes cost like Claude Code's native OTel would.
      await tracer.startActiveSpan('claude_code.llm_request', (llm) => {
        llm.setAttributes({
          'gen_ai.system': 'anthropic',
          'gen_ai.request.model': 'claude-sonnet-4-5',
          'gen_ai.usage.input_tokens': 800,
          'gen_ai.usage.output_tokens': 200,
        });
        llm.end();
      });
      setLangfuseTraceOutput(span, output);
      span.end();
    });

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    await flushLangfuse();

    const fetched = await waitForTrace(traceId!, 60_000);
    // 2 spans = parent + claude_code.llm_request.
    const observations = await waitForObservations(traceId!, 2, 60_000);

    try {
      // Trace name is the role (set by setLangfuseTraceContext).
      expect(fetched.name, 'trace.name').toBe('mind');
      // Session id grouping: persona:day when both present.
      expect(fetched.sessionId, 'trace.sessionId').toBe(`${persona}:${personaDay}`);
      // User id is the persona slug.
      expect((fetched as any).userId, 'trace.userId').toBe(persona);
      // Trace input/output round-trip.
      expect((fetched as any).input, 'trace.input').toEqual(input);
      expect((fetched as any).output, 'trace.output').toEqual(output);
      // Metadata includes the per-invocation context.
      const md = (fetched as any).metadata ?? {};
      expect(md, 'trace.metadata.role').toMatchObject({
        role: 'mind',
        invocation_id: invocationId,
        triggering_kind: triggeringKind,
        persona_day: personaDay,
        persona,
      });
      // Tags include role + persona + persona_day.
      const tags = (fetched as any).tags ?? [];
      expect(tags, 'trace.tags').toEqual(expect.arrayContaining(['mind', persona, personaDay]));
      // The child LLM gen still computes cost.
      const gen = observations.find((o) => o.name === 'claude_code.llm_request');
      expect(gen).toBeTruthy();
      expect(gen!.type).toBe('GENERATION');
      expect(gen!.usage?.input).toBe(800);
      expect(gen!.usage?.output).toBe(200);
      expect(typeof gen!.calculatedTotalCost).toBe('number');
      expect(gen!.calculatedTotalCost!).toBeGreaterThan(0);
    } catch (err) {
      console.error(
        '[langfuse e2e prod-shape] TRACE:',
        JSON.stringify(fetched, null, 2).slice(0, 4000),
      );

      console.error(
        '[langfuse e2e prod-shape] OBSERVATIONS:',
        JSON.stringify(observations, null, 2).slice(0, 4000),
      );
      throw err;
    }
  }, 120_000);
});
