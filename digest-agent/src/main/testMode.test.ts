import { describe, it, expect } from 'vitest';
import { resolveTestMode } from './testMode.js';
import type { AppConfig } from '@shared/types/config.js';

function baseConfig(): AppConfig {
  return {
    timezone: 'UTC',
    digest_dir: '/tmp',
    event_sources: [],
    mcp_servers: [],
    agent_mcp_access: { mind: [], diary: [], cold_start: [] },
    webhook: {
      public_url: 'http://x',
      bind_host: '0.0.0.0',
      bind_port: 8731,
      tunnel: { kind: 'external' },
    },
    schedule: { diary_times: [] },
    claude_code: { executable: 'claude', extra_flags: [] },
    model: { mind_agent: 'm', diary_agent: 'd', cold_start_agent: 'c', execution_agent: 'e' },
    api_key_env: 'X',
    mcp: { cache_ttl_minutes: 5 },
    log_dir: '/tmp/logs',
  };
}

describe('resolveTestMode', () => {
  it('returns testMode=false when DIGEST_TEST_CLOCK is unset', () => {
    const r = resolveTestMode({}, baseConfig());
    expect(r.testMode).toBe(false);
    expect(r.clockStart).toBeNull();
    expect(r.personaSlug).toBeNull();
    expect(r.personaRate).toBeNull();
    expect(r.executionBlocked).toBe(false);
  });

  it('returns testMode=false when DIGEST_TEST_CLOCK=wall', () => {
    const r = resolveTestMode({ DIGEST_TEST_CLOCK: 'wall' }, baseConfig());
    expect(r.testMode).toBe(false);
  });

  it('throws on unknown DIGEST_TEST_CLOCK value', () => {
    expect(() =>
      resolveTestMode({ DIGEST_TEST_CLOCK: 'rogue' }, baseConfig()),
    ).toThrow(/must be 'persona' or 'wall'/);
  });

  it('throws when persona mode but DIGEST_TEST_CLOCK_START is missing', () => {
    expect(() =>
      resolveTestMode(
        { DIGEST_TEST_CLOCK: 'persona', DIGEST_TEST_PERSONA: 'avery_chen' },
        baseConfig(),
      ),
    ).toThrow(/DIGEST_TEST_CLOCK_START/);
  });

  it('throws when DIGEST_TEST_CLOCK_START is unparseable', () => {
    expect(() =>
      resolveTestMode(
        {
          DIGEST_TEST_CLOCK: 'persona',
          DIGEST_TEST_CLOCK_START: 'not-a-date',
          DIGEST_TEST_PERSONA: 'avery_chen',
        },
        baseConfig(),
      ),
    ).toThrow(/not a valid ISO/);
  });

  it('throws when persona mode is set but no persona slug provided', () => {
    expect(() =>
      resolveTestMode(
        {
          DIGEST_TEST_CLOCK: 'persona',
          DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
        },
        baseConfig(),
      ),
    ).toThrow(/DIGEST_TEST_PERSONA/);
  });

  it('rejects persona slugs containing path-traversal characters', () => {
    expect(() =>
      resolveTestMode(
        {
          DIGEST_TEST_CLOCK: 'persona',
          DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
          DIGEST_TEST_PERSONA: '../etc/passwd',
        },
        baseConfig(),
      ),
    ).toThrow(/must match/);
  });

  it('resolves test mode happy path with default rate', () => {
    const r = resolveTestMode(
      {
        DIGEST_TEST_CLOCK: 'persona',
        DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
        DIGEST_TEST_PERSONA: 'avery_chen',
        DIGEST_TEST_SANDBOX: '1',
      },
      baseConfig(),
    );
    expect(r.testMode).toBe(true);
    expect(r.clockStart?.toISOString()).toBe('2026-04-24T00:00:00.000Z');
    expect(r.personaSlug).toBe('avery_chen');
    expect(r.personaRate).toBe('5/sec');
    expect(r.executionBlocked).toBe(true);
  });

  it('honors DIGEST_TEST_PERSONA_RATE override', () => {
    const r = resolveTestMode(
      {
        DIGEST_TEST_CLOCK: 'persona',
        DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
        DIGEST_TEST_PERSONA: 'avery_chen',
        DIGEST_TEST_PERSONA_RATE: 'burst',
      },
      baseConfig(),
    );
    expect(r.personaRate).toBe('burst');
  });

  it('does not force sandbox without DIGEST_TEST_SANDBOX=1', () => {
    const r = resolveTestMode(
      {
        DIGEST_TEST_CLOCK: 'persona',
        DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
        DIGEST_TEST_PERSONA: 'avery_chen',
      },
      baseConfig(),
    );
    expect(r.executionBlocked).toBe(false);
  });

  it('defaults personaSkipDays to 0', () => {
    const r = resolveTestMode(
      {
        DIGEST_TEST_CLOCK: 'persona',
        DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
        DIGEST_TEST_PERSONA: 'avery_chen',
      },
      baseConfig(),
    );
    expect(r.personaSkipDays).toBe(0);
  });

  it('honors DIGEST_TEST_PERSONA_SKIP_DAYS', () => {
    const r = resolveTestMode(
      {
        DIGEST_TEST_CLOCK: 'persona',
        DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
        DIGEST_TEST_PERSONA: 'avery_chen',
        DIGEST_TEST_PERSONA_SKIP_DAYS: '5',
      },
      baseConfig(),
    );
    expect(r.personaSkipDays).toBe(5);
  });

  it('throws on negative or non-integer skip days', () => {
    const env = (skip: string) => ({
      DIGEST_TEST_CLOCK: 'persona',
      DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
      DIGEST_TEST_PERSONA: 'avery_chen',
      DIGEST_TEST_PERSONA_SKIP_DAYS: skip,
    });
    expect(() => resolveTestMode(env('-3'), baseConfig())).toThrow(/non-negative integer/);
    expect(() => resolveTestMode(env('1.5'), baseConfig())).toThrow(/non-negative integer/);
    expect(() => resolveTestMode(env('abc'), baseConfig())).toThrow(/non-negative integer/);
  });

  it('defaults personaMaxDays to null', () => {
    const r = resolveTestMode(
      {
        DIGEST_TEST_CLOCK: 'persona',
        DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
        DIGEST_TEST_PERSONA: 'avery_chen',
      },
      baseConfig(),
    );
    expect(r.personaMaxDays).toBeNull();
  });

  it('honors DIGEST_TEST_PERSONA_MAX_DAYS', () => {
    const r = resolveTestMode(
      {
        DIGEST_TEST_CLOCK: 'persona',
        DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
        DIGEST_TEST_PERSONA: 'avery_chen',
        DIGEST_TEST_PERSONA_MAX_DAYS: '5',
      },
      baseConfig(),
    );
    expect(r.personaMaxDays).toBe(5);
  });

  it('treats DIGEST_TEST_PERSONA_MAX_DAYS=0 as no-cap (null)', () => {
    const r = resolveTestMode(
      {
        DIGEST_TEST_CLOCK: 'persona',
        DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
        DIGEST_TEST_PERSONA: 'avery_chen',
        DIGEST_TEST_PERSONA_MAX_DAYS: '0',
      },
      baseConfig(),
    );
    expect(r.personaMaxDays).toBeNull();
  });

  it('throws on negative or non-integer max days', () => {
    const env = (max: string) => ({
      DIGEST_TEST_CLOCK: 'persona',
      DIGEST_TEST_CLOCK_START: '2026-04-24T00:00:00Z',
      DIGEST_TEST_PERSONA: 'avery_chen',
      DIGEST_TEST_PERSONA_MAX_DAYS: max,
    });
    expect(() => resolveTestMode(env('-2'), baseConfig())).toThrow(/non-negative integer/);
    expect(() => resolveTestMode(env('2.5'), baseConfig())).toThrow(/non-negative integer/);
    expect(() => resolveTestMode(env('lots'), baseConfig())).toThrow(/non-negative integer/);
  });
});
