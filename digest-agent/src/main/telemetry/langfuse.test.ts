import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initLangfuse,
  shutdownLangfuse,
  currentTraceparent,
  subprocessTelemetryEnv,
  isLangfuseInitialized,
} from './langfuse.js';
import { trace } from '@opentelemetry/api';

// Save and restore env keys we touch so test order doesn't matter.
const KEYS = ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_BASE_URL'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])) as Record<
    string,
    string | undefined
  >;
  for (const k of KEYS) delete process.env[k];
});

afterEach(async () => {
  await shutdownLangfuse();
  for (const k of KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('langfuse telemetry', () => {
  it('is a no-op when LANGFUSE_PUBLIC_KEY is unset', () => {
    initLangfuse();
    expect(isLangfuseInitialized()).toBe(false);
    expect(subprocessTelemetryEnv(undefined)).toEqual({});
    expect(currentTraceparent()).toBeUndefined();
  });

  it('initializes and emits subprocess env keys when creds are set', () => {
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-lf-test';
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-lf-test';
    process.env['LANGFUSE_BASE_URL'] = 'https://example.langfuse.test';

    initLangfuse();
    expect(isLangfuseInitialized()).toBe(true);

    const env = subprocessTelemetryEnv(undefined);
    expect(env).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://example.langfuse.test/api/public/otel',
      OTEL_TRACES_EXPORT_INTERVAL: '1000',
    });
    // Authorization header is Basic <base64(public:secret)>.
    const expected =
      'Authorization=Basic ' + Buffer.from('pk-lf-test:sk-lf-test').toString('base64');
    expect(env['OTEL_EXPORTER_OTLP_HEADERS']).toBe(expected);
    // TRACEPARENT is only set when one is provided.
    expect(env['TRACEPARENT']).toBeUndefined();
  });

  it('includes TRACEPARENT when one is provided', () => {
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-lf-test';
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-lf-test';
    initLangfuse();
    const tp = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
    expect(subprocessTelemetryEnv(tp)['TRACEPARENT']).toBe(tp);
  });

  it('sets LANGFUSE_SESSION_ID and OTEL_RESOURCE_ATTRIBUTES when ctx is provided', () => {
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-lf-test';
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-lf-test';
    process.env['DIGEST_TEST_PERSONA'] = 'avery_chen';
    initLangfuse();

    const tp = '00-aabbccddeeff00112233445566778899-0123456789abcdef-01';
    const env = subprocessTelemetryEnv(tp, {
      personaDay: '2026-05-14',
      invocationId: 'inv_test123',
    });

    // Session ID is persona:day when persona is available.
    expect(env['LANGFUSE_SESSION_ID']).toBe('avery_chen:2026-05-14');

    // OTEL_RESOURCE_ATTRIBUTES includes session, user, and parent trace id.
    const attrs = env['OTEL_RESOURCE_ATTRIBUTES'] ?? '';
    expect(attrs).toContain('langfuse.session.id=avery_chen:2026-05-14');
    expect(attrs).toContain('langfuse.user.id=avery_chen');
    // Parent trace id extracted from the traceparent.
    expect(attrs).toContain('digest.parent_trace_id=aabbccddeeff00112233445566778899');

    delete process.env['DIGEST_TEST_PERSONA'];
  });

  it('falls back to invocationId as session when persona and day are absent', () => {
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-lf-test';
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-lf-test';
    initLangfuse();

    const env = subprocessTelemetryEnv(undefined, { invocationId: 'inv_fallback' });
    expect(env['LANGFUSE_SESSION_ID']).toBe('inv_fallback');
    const attrs = env['OTEL_RESOURCE_ATTRIBUTES'] ?? '';
    expect(attrs).toContain('langfuse.session.id=inv_fallback');
    // No user id — persona not set.
    expect(attrs).not.toContain('langfuse.user.id');
    // No parent trace id — traceparent not provided.
    expect(attrs).not.toContain('digest.parent_trace_id');
  });

  it('currentTraceparent returns a well-formed W3C string inside an active span', async () => {
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-lf-test';
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-lf-test';
    initLangfuse();

    const tracer = trace.getTracer('test');
    const tp = await tracer.startActiveSpan('t', (span) => {
      const out = currentTraceparent();
      span.end();
      return out;
    });
    expect(tp).toBeTruthy();
    // Format: 00-<32 hex>-<16 hex>-01
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('defaults LANGFUSE_BASE_URL to cloud.langfuse.com', () => {
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-lf-test';
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-lf-test';
    // No LANGFUSE_BASE_URL set.
    initLangfuse();
    const env = subprocessTelemetryEnv(undefined);
    expect(env['OTEL_EXPORTER_OTLP_ENDPOINT']).toBe(
      'https://cloud.langfuse.com/api/public/otel',
    );
  });
});
