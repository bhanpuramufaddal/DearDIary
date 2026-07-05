/**
 * Diary scheduler.
 *
 * Reads `config.schedule.diary_times` (HH:MM in the principal's timezone) and
 * emits `schedule.diary_tick` whenever the clock reaches the next such instant.
 *
 * Each fire re-arms for the next slot AFTER the just-fired time (not after
 * `clock.now()` — that matters in test mode where `advanceTo` may have
 * already advanced the clock past several future slots; arming "after now"
 * would skip them all).
 *
 * Recomputes from scratch on each fire — handles DST shifts, laptop sleep,
 * clock skew, config changes mid-wait, and the test-mode persona-clock
 * advancing across many days at once (one advanceTo → up to N × |diary_times|
 * fires, all chained through the AdjustableClock drain loop).
 *
 * Architecture: design/08-runtime.md § "Subsystem 4: diary scheduler".
 */

import type { Bus } from '../bus.js';
import type { AppConfig } from '@shared/types/config.js';
import type { Clock } from '../clock.js';
import { nextFireAt } from './timezone.js';

export interface DiaryScheduler {
  start(): void;
  stop(): void;
  /** Next-fire instant if armed, else null. For diagnostics + tests. */
  nextFire(): Date | null;
}

export interface DiarySchedulerOptions {
  clock: Clock;
}

export function createDiaryScheduler(
  config: AppConfig,
  bus: Bus,
  opts: DiarySchedulerOptions,
): DiaryScheduler {
  const clock = opts.clock;
  let cancelArmed: (() => void) | null = null;
  let armedFor: Date | null = null;
  let stopped = false;

  function pickNextFire(after: Date): Date | null {
    const times = config.schedule.diary_times;
    if (times.length === 0) return null;
    let earliest: Date | null = null;
    for (const t of times) {
      const candidate = nextFireAt(t, config.timezone, after);
      if (!earliest || candidate < earliest) earliest = candidate;
    }
    return earliest;
  }

  function armAfter(after: Date): void {
    if (stopped) return;
    if (cancelArmed) {
      cancelArmed();
      cancelArmed = null;
    }
    const next = pickNextFire(after);
    if (!next) return;
    armedFor = next;
    cancelArmed = clock.scheduleAt(next, async () => {
      cancelArmed = null;
      armedFor = null;
      try {
        await bus.emit('schedule.diary_tick', { trigger_at: next.toISOString() });
      } catch (err) {
        console.error('[diary-scheduler] emit failed:', err);
      }
      // Compute next slot relative to the JUST-FIRED time, not clock.now() —
      // under AdjustableClock, clock.now() may already be at the advance target,
      // far past several intermediate slots we still need to fire.
      armAfter(next);
    });
  }

  return {
    start() {
      stopped = false;
      armAfter(clock.now());
    },
    stop() {
      stopped = true;
      if (cancelArmed) {
        cancelArmed();
        cancelArmed = null;
      }
      armedFor = null;
    },
    nextFire() {
      return armedFor;
    },
  };
}
