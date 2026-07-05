/**
 * Pure resolver for the persona-emulator test-mode env vars.
 *
 * Two valid shapes:
 *   - normal mode: `DIGEST_TEST_CLOCK` unset (or `'wall'`)
 *   - test mode:   `DIGEST_TEST_CLOCK=persona`, `DIGEST_TEST_CLOCK_START=<ISO>`,
 *                  `DIGEST_TEST_PERSONA=<slug>`, and (optionally)
 *                  `DIGEST_TEST_PERSONA_RATE=<N>/sec|burst` (default `5/sec`).
 *
 * Anything else throws. No silent fallbacks — a misconfigured test mode must
 * fail at boot, never silently downgrade.
 *
 * Lives in its own module (not boot.ts) so tests can import it without
 * dragging in boot.ts's electron-only deps (windows, ipc).
 */

import type { AppConfig } from '@shared/types/config.js';

export interface ResolvedTestMode {
  testMode: boolean;
  /**
   * The configured DIGEST_TEST_CLOCK_START — i.e. the persona's day 0.
   * Boot.ts shifts the actual clock start by `personaSkipDays` so schedulers
   * arm against the post-skip "now"; this field is the raw input.
   */
  clockStart: Date | null;
  executionBlocked: boolean;
  personaSlug: string | null;
  personaRate: string | null;
  /**
   * Days of the persona's timeline to skip from the front. Events in this
   * window are still on disk (substrate can read them via MCP) but are NOT
   * emitted on the bus, and the clock starts at `clockStart + skipDays * 24h`.
   * 0 (default) emits the entire timeline.
   */
  personaSkipDays: number;
  /**
   * Cap on simulated days to stream (counting from the post-skip start). Events
   * whose `occurred_at` falls at or after `clockStart + (skipDays + maxDays) * 24h`
   * are dropped. `null` (default) means "no cap — stream the whole timeline".
   */
  personaMaxDays: number | null;
}

const DEFAULT_PERSONA_RATE = '5/sec';
const SLUG_REGEX = /^[a-z0-9_-]+$/;

export function resolveTestMode(
  env: NodeJS.ProcessEnv,
  _config: AppConfig,
): ResolvedTestMode {
  const testClockKind = env['DIGEST_TEST_CLOCK'];

  if (testClockKind === undefined || testClockKind === 'wall') {
    return {
      testMode: false,
      clockStart: null,
      executionBlocked: false,
      personaSlug: null,
      personaRate: null,
      personaSkipDays: 0,
      personaMaxDays: null,
    };
  }
  if (testClockKind !== 'persona') {
    throw new Error(
      `DIGEST_TEST_CLOCK must be 'persona' or 'wall' (or unset); got: ${testClockKind}`,
    );
  }

  const startStr = env['DIGEST_TEST_CLOCK_START'];
  if (!startStr) {
    throw new Error(
      'DIGEST_TEST_CLOCK=persona requires DIGEST_TEST_CLOCK_START (ISO datetime) to be set.',
    );
  }
  const clockStart = new Date(startStr);
  if (isNaN(clockStart.getTime())) {
    throw new Error(`DIGEST_TEST_CLOCK_START is not a valid ISO datetime: ${startStr}`);
  }

  const personaSlug = env['DIGEST_TEST_PERSONA'];
  if (!personaSlug) {
    throw new Error(
      'DIGEST_TEST_CLOCK=persona requires DIGEST_TEST_PERSONA (persona slug, e.g. ' +
        '"avery_chen") to be set. The slug must match a directory under ' +
        '../persona-generator/data/personas/.',
    );
  }
  if (!SLUG_REGEX.test(personaSlug)) {
    throw new Error(
      `DIGEST_TEST_PERSONA must match /^[a-z0-9_-]+$/ (got '${personaSlug}'). ` +
        'Path-traversal characters are not allowed.',
    );
  }

  const personaRate = env['DIGEST_TEST_PERSONA_RATE'] ?? DEFAULT_PERSONA_RATE;

  const skipDaysStr = env['DIGEST_TEST_PERSONA_SKIP_DAYS'];
  let personaSkipDays = 0;
  if (skipDaysStr !== undefined && skipDaysStr !== '') {
    const n = Number(skipDaysStr);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `DIGEST_TEST_PERSONA_SKIP_DAYS must be a non-negative integer (got '${skipDaysStr}').`,
      );
    }
    personaSkipDays = n;
  }

  const maxDaysStr = env['DIGEST_TEST_PERSONA_MAX_DAYS'];
  let personaMaxDays: number | null = null;
  if (maxDaysStr !== undefined && maxDaysStr !== '') {
    const n = Number(maxDaysStr);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `DIGEST_TEST_PERSONA_MAX_DAYS must be a non-negative integer (got '${maxDaysStr}').`,
      );
    }
    // 0 is treated as "no cap" — same as unset — so 5 means "five days", not "zero days".
    personaMaxDays = n === 0 ? null : n;
  }

  return {
    testMode: true,
    clockStart,
    executionBlocked: env['DIGEST_TEST_SANDBOX'] === '1',
    personaSlug,
    personaRate,
    personaSkipDays,
    personaMaxDays,
  };
}
