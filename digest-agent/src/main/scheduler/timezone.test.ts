import { describe, it, expect } from 'vitest';
import { nextFireAt, timezoneOffsetMinutes } from './timezone.js';

describe('timezoneOffsetMinutes', () => {
  it('returns negative for west of UTC', () => {
    // 2026-05-25 (PDT, UTC-7) — offset is -420 minutes.
    const at = new Date('2026-05-25T12:00:00Z');
    expect(timezoneOffsetMinutes(at, 'America/Los_Angeles')).toBe(-420);
  });

  it('returns positive for east of UTC', () => {
    // Asia/Tokyo is UTC+9 — +540 minutes.
    const at = new Date('2026-05-25T12:00:00Z');
    expect(timezoneOffsetMinutes(at, 'Asia/Tokyo')).toBe(540);
  });

  it('handles DST transitions for the local zone', () => {
    // PST (UTC-8, winter) vs PDT (UTC-7, summer)
    const winter = new Date('2026-01-15T12:00:00Z');
    const summer = new Date('2026-07-15T12:00:00Z');
    expect(timezoneOffsetMinutes(winter, 'America/Los_Angeles')).toBe(-480);
    expect(timezoneOffsetMinutes(summer, 'America/Los_Angeles')).toBe(-420);
  });
});

describe('nextFireAt', () => {
  it('returns today if HH:MM is later today (PDT)', () => {
    // 9am PDT on May 25 2026 == 16:00 UTC
    const after = new Date('2026-05-25T15:00:00Z'); // 8am PDT
    const next = nextFireAt('09:00', 'America/Los_Angeles', after);
    expect(next.toISOString()).toBe('2026-05-25T16:00:00.000Z');
  });

  it('rolls to tomorrow if HH:MM has already passed today', () => {
    // 8am PDT today; ask for 06:00 PDT next fire
    const after = new Date('2026-05-25T15:00:00Z');
    const next = nextFireAt('06:00', 'America/Los_Angeles', after);
    expect(next.toISOString()).toBe('2026-05-26T13:00:00.000Z'); // 6am PDT next day = 13:00 UTC
  });

  it('handles UTC zone', () => {
    const after = new Date('2026-05-25T09:00:00Z');
    const next = nextFireAt('12:00', 'UTC', after);
    expect(next.toISOString()).toBe('2026-05-25T12:00:00.000Z');
  });
});
