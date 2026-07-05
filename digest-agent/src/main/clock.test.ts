import { describe, it, expect } from 'vitest';
import { AdjustableClock, WallClock } from './clock.js';

describe('WallClock', () => {
  it('returns a real Date from now()', () => {
    const c = new WallClock();
    const before = Date.now();
    const t = c.now().getTime();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('fires scheduled callbacks after the delay', async () => {
    const c = new WallClock();
    const fired: string[] = [];
    const at = new Date(Date.now() + 20);
    c.scheduleAt(at, () => { fired.push('hit'); });
    await new Promise((r) => setTimeout(r, 40));
    expect(fired).toEqual(['hit']);
  });

  it('fires immediately for past times', async () => {
    const c = new WallClock();
    const fired: string[] = [];
    const at = new Date(Date.now() - 1000);
    c.scheduleAt(at, () => { fired.push('hit'); });
    await new Promise((r) => setImmediate(r));
    expect(fired).toEqual(['hit']);
  });

  it('unsubscribe cancels the callback', async () => {
    const c = new WallClock();
    const fired: string[] = [];
    const at = new Date(Date.now() + 20);
    const unsub = c.scheduleAt(at, () => { fired.push('hit'); });
    unsub();
    await new Promise((r) => setTimeout(r, 40));
    expect(fired).toEqual([]);
  });
});

describe('AdjustableClock', () => {
  const T0 = new Date('2026-05-01T00:00:00Z');

  it('returns the initial time from now()', () => {
    const c = new AdjustableClock(T0);
    expect(c.now().toISOString()).toBe(T0.toISOString());
  });

  it('advanceTo moves the clock and fires due callbacks', async () => {
    const c = new AdjustableClock(T0);
    const fired: string[] = [];
    c.scheduleAt(new Date('2026-05-01T06:00:00Z'), () => { fired.push('06'); });
    c.scheduleAt(new Date('2026-05-01T21:00:00Z'), () => { fired.push('21'); });

    await c.advanceTo(new Date('2026-05-01T10:00:00Z'));
    expect(fired).toEqual(['06']);
    expect(c.pendingCount()).toBe(1);

    await c.advanceTo(new Date('2026-05-02T00:00:00Z'));
    expect(fired).toEqual(['06', '21']);
    expect(c.pendingCount()).toBe(0);
  });

  it('fires due callbacks in chronological order even when scheduled out of order', async () => {
    const c = new AdjustableClock(T0);
    const fired: string[] = [];
    c.scheduleAt(new Date('2026-05-01T21:00:00Z'), () => { fired.push('21'); });
    c.scheduleAt(new Date('2026-05-01T06:00:00Z'), () => { fired.push('06'); });
    c.scheduleAt(new Date('2026-05-01T12:00:00Z'), () => { fired.push('12'); });

    await c.advanceTo(new Date('2026-05-02T00:00:00Z'));
    expect(fired).toEqual(['06', '12', '21']);
  });

  it('chains re-scheduling callbacks within a single advanceTo', async () => {
    // Simulates the diary scheduler: each fire re-arms for the next slot.
    const c = new AdjustableClock(T0);
    const fired: string[] = [];
    function arm(at: Date): void {
      c.scheduleAt(at, () => {
        fired.push(at.toISOString());
        // Re-arm for 12 hours later, up to a cutoff.
        const next = new Date(at.getTime() + 12 * 60 * 60 * 1000);
        if (next.getTime() <= new Date('2026-05-04T00:00:00Z').getTime()) {
          arm(next);
        }
      });
    }
    arm(new Date('2026-05-01T06:00:00Z'));

    await c.advanceTo(new Date('2026-05-04T00:00:00Z'));
    // 06:00 day 1, 18:00 day 1, 06:00 day 2, 18:00 day 2, 06:00 day 3, 18:00 day 3 = 6 fires
    expect(fired).toEqual([
      '2026-05-01T06:00:00.000Z',
      '2026-05-01T18:00:00.000Z',
      '2026-05-02T06:00:00.000Z',
      '2026-05-02T18:00:00.000Z',
      '2026-05-03T06:00:00.000Z',
      '2026-05-03T18:00:00.000Z',
    ]);
  });

  it('is monotonic — advanceTo backwards is a no-op', async () => {
    const c = new AdjustableClock(T0);
    const fired: string[] = [];
    c.scheduleAt(new Date('2026-05-01T06:00:00Z'), () => { fired.push('06'); });

    await c.advanceTo(new Date('2026-05-01T12:00:00Z'));
    expect(fired).toEqual(['06']);
    expect(c.now().toISOString()).toBe('2026-05-01T12:00:00.000Z');

    await c.advanceTo(new Date('2026-05-01T05:00:00Z')); // earlier — ignored
    expect(c.now().toISOString()).toBe('2026-05-01T12:00:00.000Z');
  });

  it('unsubscribe removes a scheduled callback before it fires', async () => {
    const c = new AdjustableClock(T0);
    const fired: string[] = [];
    const unsub = c.scheduleAt(new Date('2026-05-01T06:00:00Z'), () => { fired.push('hit'); });
    unsub();
    await c.advanceTo(new Date('2026-05-02T00:00:00Z'));
    expect(fired).toEqual([]);
  });

  it('throws if a callback re-schedules itself indefinitely (drain safety)', async () => {
    const c = new AdjustableClock(T0);
    function arm(at: Date): void {
      c.scheduleAt(at, () => {
        // Always re-arm BEFORE the target — guarantees runaway.
        arm(new Date(at.getTime() + 1000));
      });
    }
    arm(new Date('2026-05-01T06:00:00Z'));
    await expect(c.advanceTo(new Date('2027-05-01T00:00:00Z'))).rejects.toThrow(
      /drained .* without exhausting/,
    );
  });
});
