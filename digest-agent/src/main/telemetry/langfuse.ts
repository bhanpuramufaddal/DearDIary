/**
 * Langfuse observability — OpenTelemetry init + subprocess env shaping.
 *
 * The Electron main process opens one OTel span per dispatcher invocation
 * (mind / diary / cold-start). The W3C `TRACEPARENT` for that span is passed
 * into the Claude Code subprocess via env vars; Claude Code's native OTel
 * export (`claude_code.interaction` / `claude_code.llm_request` /
 * `claude_code.tool` spans) becomes children of our parent. Both sides
 * export to Langfuse's OTLP endpoint at <BASE_URL>/api/public/otel.
 *
 * Token usage and cost are auto-computed by Langfuse from the model
 * attribute on `claude_code.llm_request` spans.
 *
 * "No-op when unset" lives here: if LANGFUSE_PUBLIC_KEY is absent, every
 * exported function is a quiet no-op so tests and dev runs without
 * credentials don't break.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { trace, type Span } from '@opentelemetry/api';

let sdk: NodeSDK | null = null;
let processor: LangfuseSpanProcessor | null = null;
let authHeader = '';
let baseUrl = '';

function envOrDefault(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

/**
 * Initialize the Langfuse OpenTelemetry pipeline if credentials are present.
 * Idempotent — calling twice is a no-op after the first success.
 */
export function initLangfuse(): void {
  if (sdk) return;
  const publicKey = process.env['LANGFUSE_PUBLIC_KEY'];
  const secretKey = process.env['LANGFUSE_SECRET_KEY'];
  if (!publicKey || !secretKey) {
    // Quiet no-op: keeps tests + credential-less dev runs working.
    return;
  }
  baseUrl = envOrDefault('LANGFUSE_BASE_URL', 'https://cloud.langfuse.com');
  // Cache the Basic auth header once — both the in-process exporter (via
  // LangfuseSpanProcessor's env-var reads) and the subprocess (via
  // OTEL_EXPORTER_OTLP_HEADERS) use it.
  authHeader = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;

  processor = new LangfuseSpanProcessor({
    // Default filter only exports `gen_ai.*` spans + spans from known LLM
    // instrumentors — that would drop OUR parent span and the MCP-tool
    // spans, keeping only Claude Code's LLM-request spans. We want the
    // full hierarchy (per-invocation parent → claude_code.* children →
    // tool calls), so accept every span we open.
    shouldExportSpan: () => true,
  });
  sdk = new NodeSDK({ spanProcessors: [processor] });
  sdk.start();
  console.log(`[langfuse] initialized — exporting to ${baseUrl}/api/public/otel`);
}

/**
 * Force the batched span processor to ship pending spans NOW. Used by tests
 * that want to query Langfuse immediately after a span ends, without
 * tearing down the SDK (which can leave OTel's global provider in a bad
 * state for any subsequent init).
 */
export async function flushLangfuse(): Promise<void> {
  if (!processor) return;
  await processor.forceFlush();
}

/**
 * Flush + shut down the SDK. Awaited from boot.shutdown() at app exit.
 */
export async function shutdownLangfuse(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (err) {
    console.error('[langfuse] shutdown error:', err);
  } finally {
    sdk = null;
    processor = null;
  }
}

/**
 * W3C traceparent for the currently-active OTel span, or undefined if there
 * is no active span (or Langfuse isn't initialized). Format: `00-<32hex>-<16hex>-01`.
 */
export function currentTraceparent(): string | undefined {
  if (!sdk) return undefined;
  const span: Span | undefined = trace.getActiveSpan();
  if (!span) return undefined;
  const ctx = span.spanContext();
  if (!ctx.traceId || !ctx.spanId) return undefined;
  // sampled flag bit 1 → "01"; we always sample.
  return `00-${ctx.traceId}-${ctx.spanId}-01`;
}

/**
 * Env vars to merge into a Claude Code subprocess spawn so its OTel export
 * lands in Langfuse and its traces are correlated with our parent invocation.
 *
 * Trace nesting (TRACEPARENT): Claude Code does not currently propagate the
 * W3C traceparent into its own OTel root span, so subprocess spans appear as
 * separate root traces rather than as children. We still pass TRACEPARENT in
 * case a future Claude Code version honours it.
 *
 * Session correlation: we inject LANGFUSE_SESSION_ID and OTEL_RESOURCE_ATTRIBUTES
 * so Claude Code's traces land in the same Langfuse session as our parent span
 * and carry the persona userId. This gives a navigable link even without nesting.
 *
 * Returns `{}` when Langfuse isn't initialized so callers don't have to branch.
 */
export function subprocessTelemetryEnv(
  traceparent: string | undefined,
  ctx?: Pick<LangfuseTraceContext, 'personaDay' | 'persona' | 'invocationId'>,
): Record<string, string> {
  if (!sdk) return {};

  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_EXPORTER_OTLP_ENDPOINT: `${baseUrl}/api/public/otel`,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=${authHeader}`,
    // Claude Code's default export interval is 5s; short-lived invocations
    // (especially mind) would lose telemetry on exit without a shorter interval.
    OTEL_TRACES_EXPORT_INTERVAL: '1000',
  };

  if (traceparent) env['TRACEPARENT'] = traceparent;

  if (ctx) {
    const persona = ctx.persona ?? process.env['DIGEST_TEST_PERSONA'];
    const sessionId = computeSessionId(ctx);

    // LANGFUSE_SESSION_ID: Langfuse's own env var for SDK-based session tagging.
    // If Claude Code's Langfuse integration reads this, all subprocess traces
    // land in the same session as our parent span.
    env['LANGFUSE_SESSION_ID'] = sessionId;

    // OTEL_RESOURCE_ATTRIBUTES: attached to every span Claude Code exports.
    // Langfuse stores these in trace metadata — enables correlation by session
    // ID and user even when spans are separate root traces.
    const resourceAttrs: string[] = [`langfuse.session.id=${sessionId}`];
    if (persona) resourceAttrs.push(`langfuse.user.id=${persona}`);
    // Pass our parent traceId as metadata so you can navigate from
    // Claude Code's traces back to the invocation that spawned them.
    if (traceparent) {
      const parentTraceId = traceparent.split('-')[1];
      if (parentTraceId) resourceAttrs.push(`digest.parent_trace_id=${parentTraceId}`);
    }
    env['OTEL_RESOURCE_ATTRIBUTES'] = resourceAttrs.join(',');
  }

  return env;
}

/** True iff Langfuse was successfully initialized. Used by tests. */
export function isLangfuseInitialized(): boolean {
  return sdk !== null;
}

/**
 * Compute the Langfuse sessionId for a given invocation context. Shared between
 * setLangfuseTraceContext (parent span) and subprocessTelemetryEnv (subprocess).
 */
export function computeSessionId(
  ctx: Pick<LangfuseTraceContext, 'personaDay' | 'persona' | 'invocationId'>,
): string {
  const persona = ctx.persona ?? process.env['DIGEST_TEST_PERSONA'];
  return ctx.personaDay && persona
    ? `${persona}:${ctx.personaDay}`
    : ctx.personaDay ?? ctx.invocationId;
}

// ─── Trace context helpers ─────────────────────────────────────────────────
//
// Langfuse's OTel ingestion maps very-specifically-named attributes onto the
// API's trace/observation fields (verified in langfuse.e2e.test.ts). These
// helpers wrap the magic-string namespace so the dispatchers don't have to
// know it — they just hand over a context object and we set the right
// `langfuse.*` attributes on the parent span.

export interface LangfuseTraceContext {
  /** Becomes the trace name (UI label) + a tag. e.g. 'mind' / 'diary' / 'cold-start'. */
  role: string;
  /** Stable id for this invocation — included in metadata + the fallback session id. */
  invocationId: string;
  /** Persona-local YYYY-MM-DD this invocation pertains to. Used as session id when present. */
  personaDay?: string;
  /** Persona slug (e.g. 'avery_chen'). Defaults to `DIGEST_TEST_PERSONA` env. */
  persona?: string;
  /** Bus kind that triggered the invocation (mind) or 'schedule'/'profile.changed' (diary/cold-start). */
  triggeringKind?: string;
  /** Extra fields merged into `trace.metadata`. */
  extraMetadata?: Record<string, unknown>;
  /** Trace input (what the agent was given). Anything JSON-stringifiable. */
  input?: unknown;
}

/**
 * Set Langfuse-recognized attributes on the parent span so the Langfuse API's
 * trace fields (`name`, `sessionId`, `userId`, `metadata`, `tags`,
 * `environment`, `input`) populate correctly. No-op if Langfuse isn't
 * initialized (so dispatchers can call it unconditionally).
 */
/** Returns the computed sessionId so dispatchers can pass it to correlateSubprocessTraces. */
export function setLangfuseTraceContext(span: Span, ctx: LangfuseTraceContext): string {
  const sessionId = computeSessionId(ctx);
  if (!sdk) return sessionId;
  const persona = ctx.persona ?? process.env['DIGEST_TEST_PERSONA'];

  const tags = [
    ctx.role,
    ...(persona ? [persona] : []),
    ...(ctx.personaDay ? [ctx.personaDay] : []),
  ];

  const metadata: Record<string, unknown> = {
    invocation_id: ctx.invocationId,
    role: ctx.role,
    ...(ctx.triggeringKind ? { triggering_kind: ctx.triggeringKind } : {}),
    ...(ctx.personaDay ? { persona_day: ctx.personaDay } : {}),
    ...(persona ? { persona } : {}),
    ...(ctx.extraMetadata ?? {}),
  };

  span.setAttributes({
    'langfuse.trace.name': ctx.role,
    'langfuse.observation.type': 'span',
    'langfuse.session.id': sessionId,
    ...(persona ? { 'langfuse.user.id': persona } : {}),
    'langfuse.trace.metadata': JSON.stringify(metadata),
    'langfuse.trace.tags': JSON.stringify(tags),
    ...(ctx.input !== undefined
      ? { 'langfuse.trace.input': JSON.stringify(ctx.input) }
      : {}),
    ...(process.env['LANGFUSE_TRACING_ENVIRONMENT']
      ? { 'langfuse.environment': process.env['LANGFUSE_TRACING_ENVIRONMENT'] }
      : {}),
  });
  return sessionId;
}

/**
 * Set the trace output at end-of-invocation. Call AFTER `invoke()` returns and
 * BEFORE `span.end()`. No-op when Langfuse isn't initialized.
 */
export function setLangfuseTraceOutput(span: Span, output: unknown): void {
  if (!sdk) return;
  span.setAttribute('langfuse.trace.output', JSON.stringify(output));
}

// ─── Anthropic pricing (USD per token) ────────────────────────────────────────
// Used by correlateSubprocessTraces to compute exact costs from Claude Code's
// custom token-count attributes (input_tokens, output_tokens, cache_*_tokens).
const ANTHROPIC_PRICE: Record<string, { input: number; cacheWrite: number; cacheRead: number; output: number }> = {
  'claude-sonnet-4-6':           { input: 3e-6,   cacheWrite: 3.75e-6,  cacheRead: 3e-7,   output: 15e-6 },
  'claude-opus-4-6':             { input: 15e-6,  cacheWrite: 18.75e-6, cacheRead: 1.5e-6, output: 75e-6 },
  'claude-haiku-4-5':            { input: 0.8e-6, cacheWrite: 1e-6,     cacheRead: 8e-8,   output: 4e-6  },
  'claude-haiku-4-5-20251001':   { input: 0.8e-6, cacheWrite: 1e-6,     cacheRead: 8e-8,   output: 4e-6  },
  'claude-sonnet-4-5':           { input: 3e-6,   cacheWrite: 3.75e-6,  cacheRead: 3e-7,   output: 15e-6 },
  'claude-sonnet-4-5-20251001':  { input: 3e-6,   cacheWrite: 3.75e-6,  cacheRead: 3e-7,   output: 15e-6 },
};

function anthropicCost(
  model: string | null | undefined,
  attrs: Record<string, unknown>,
): { input: number; output: number; total: number; totalCost: number; details: Record<string, number> } | null {
  const price = ANTHROPIC_PRICE[model ?? ''];
  if (!price) return null;

  const inputTok    = Number(attrs['input_tokens']           ?? 0);
  const outputTok   = Number(attrs['output_tokens']          ?? 0);
  const cacheRead   = Number(attrs['cache_read_tokens']      ?? 0);
  const cacheWrite  = Number(attrs['cache_creation_tokens']  ?? 0);

  if (isNaN(inputTok) || isNaN(outputTok)) return null;
  if (inputTok === 0 && outputTok === 0 && cacheRead === 0 && cacheWrite === 0) return null;

  const inputCost       = inputTok   * price.input;
  const cacheReadCost   = cacheRead  * price.cacheRead;
  const cacheWriteCost  = cacheWrite * price.cacheWrite;
  const outputCost      = outputTok  * price.output;

  return {
    input:      inputTok + cacheRead + cacheWrite,
    output:     outputTok,
    total:      inputTok + cacheRead + cacheWrite + outputTok,
    totalCost:  inputCost + cacheReadCost + cacheWriteCost + outputCost,
    details: { input_tokens: inputTok, cache_read_tokens: cacheRead, cache_creation_tokens: cacheWrite, output_tokens: outputTok },
  };
}

// Observation shape used by correlateSubprocessTraces.
interface GenObservation {
  id: string;
  type: string;
  model?: string | null;
  usage?: { input?: number; output?: number };
  metadata?: { attributes?: Record<string, unknown> };
}

type IngestionItem = { type: string; id: string; timestamp: string; body: Record<string, unknown> };

/**
 * Post-hoc Langfuse patch run after each invocation.
 *
 * Claude Code's subprocess traces can land in Langfuse with a UUID sessionId,
 * a machine-hash userId, and $0 cost (wrong attribute names for token counts).
 * This function corrects all three:
 *   1. Patches sessionId/userId on orphaned traces (UUID session → our session).
 *   2. Maps Claude Code's token attrs (input_tokens, cache_*_tokens, output_tokens)
 *      to standard usage fields with exact Anthropic pricing.
 *
 * Runs up to MAX_ROUNDS passes, 8s apart, stopping when no new unpatch­ed
 * generations are found. The retry loop is needed because some spans (especially
 * `claude_code.llm_request`) arrive in Langfuse slightly after the others and
 * are missed by a single-shot query.
 *
 * Fire-and-forget — never blocks the dispatcher.
 */
export async function correlateSubprocessTraces(opts: {
  sessionId: string;
  userId?: string;
  startedAt: string;    // ISO — when invoke() was called
  endedAt: string;      // ISO — when subprocess exited
  parentTraceId?: string;  // OTel traceId of parent span — excluded from orphan scan
}): Promise<void> {
  if (!sdk) return;

  const uid = () => `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  // Pre-build the orphan-trace query URL once (window is stable across rounds).
  const toTs = new Date(new Date(opts.endedAt).getTime() + 60_000).toISOString();
  const traceListUrl =
    `${baseUrl}/api/public/traces?limit=100&orderBy=timestamp.asc` +
    `&fromTimestamp=${encodeURIComponent(opts.startedAt)}&toTimestamp=${encodeURIComponent(toTs)}`;

  // Initial wait for the OTel export batch (1s interval) + Langfuse ingestion pipeline.
  await new Promise((r) => setTimeout(r, 10_000));

  const MAX_ROUNDS = 4;
  const ROUND_GAP_MS = 8_000;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, ROUND_GAP_MS));

    const now = new Date().toISOString();
    const batch: IngestionItem[] = [];

    // ── 1. Orphaned traces (when TRACEPARENT didn't propagate or older Claude Code) ──
    const listResp = await fetch(traceListUrl, { headers: { Authorization: authHeader } });
    if (listResp.ok) {
      const { data: traces } = (await listResp.json()) as {
        data: Array<{ id: string; name: string; sessionId?: string | null }>;
      };

      for (const trace of traces) {
        if (trace.id === opts.parentTraceId) continue;
        if (!trace.name.startsWith('claude_code.') && trace.name !== '') continue;

        // Patch session/user when Claude Code used its own UUID session.
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(trace.sessionId ?? '')) {
          batch.push({
            type: 'trace-update', id: uid(), timestamp: now,
            body: { id: trace.id, sessionId: opts.sessionId, ...(opts.userId ? { userId: opts.userId } : {}) },
          });
        }

        // Patch token counts on orphaned generations.
        const obsResp = await fetch(
          `${baseUrl}/api/public/observations?traceId=${trace.id}&type=GENERATION&limit=100`,
          { headers: { Authorization: authHeader } },
        );
        if (obsResp.ok) {
          const { data: obs } = (await obsResp.json()) as { data: GenObservation[] };
          for (const o of obs) collectGenPatch(batch, uid, now, o, trace.id);
        }
      }
    }

    // ── 2. Nested generations inside our parent span (TRACEPARENT works in 2.1.173+) ──
    if (opts.parentTraceId) {
      const ownObsResp = await fetch(
        `${baseUrl}/api/public/observations?traceId=${opts.parentTraceId}&type=GENERATION&limit=100`,
        { headers: { Authorization: authHeader } },
      );
      if (ownObsResp.ok) {
        const { data: ownObs } = (await ownObsResp.json()) as { data: GenObservation[] };
        for (const o of ownObs) collectGenPatch(batch, uid, now, o, opts.parentTraceId);
      }
    }

    // Nothing left to patch in this round — all generations are accounted for.
    if (batch.length === 0) break;

    const ingestResp = await fetch(`${baseUrl}/api/public/ingestion`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch }),
    });
    if (!ingestResp.ok) {
      const body = await ingestResp.text().catch(() => '');
      throw new Error(`[langfuse] ingestion failed ${ingestResp.status}: ${body.slice(0, 200)}`);
    }
  }
}

/** Build a generation-update patch item if the observation needs it. Mutates `batch`. */
function collectGenPatch(
  batch: IngestionItem[],
  uid: () => string,
  now: string,
  o: GenObservation,
  traceId: string,
): void {
  // Skip non-generations and already-patched observations.
  if (o.type !== 'GENERATION') return;
  if ((o.usage?.input ?? 0) > 0 || (o.usage?.output ?? 0) > 0) return;

  const cost = anthropicCost(o.model, o.metadata?.attributes ?? {});
  if (!cost) return;

  batch.push({
    type: 'generation-update',
    id: uid(),
    timestamp: now,
    body: {
      id: o.id,
      traceId,
      ...(o.model ? { model: o.model } : {}),
      usage: { input: cost.input, output: cost.output, total: cost.total, unit: 'TOKENS', totalCost: cost.totalCost },
      usageDetails: cost.details,
    },
  });
}
