/**
 * Clock abstraction — the only place in main that holds a notion of "now".
 *
 * Why an abstraction:
 *   - Production runs against wall-clock time (the principal's real day).
 *   - Test / persona-emulator runs against the persona's synthetic timeline:
 *     30 simulated days can stream by in 30 real seconds, and digest-agent's
 *     schedulers must see those day boundaries cross even though wall-clock
 *     hasn't moved. See docs/testing/run-avery-chen.md.
 *
 * The interface is intentionally narrow:
 *   - `now()` — read the current time.
 *   - `scheduleAt(at, cb)` — fire `cb` when the clock reaches `at`. Returns
 *     an unsubscribe handle. Replaces `setTimeout`-driven arming so both wall
 *     and adjustable clocks present the same API.
 *
 * The two impls:
 *   - `WallClock`: setTimeout-backed; ticks at the OS scheduler's granularity.
 *   - `AdjustableClock`: callback list keyed by target time; advances only via
 *     explicit `advanceTo(target)` calls (driven by the persona-clock subsystem
 *     in test mode). Monotonic — never rewinds. Re-checks the schedule after
 *     each callback in case the cb scheduled a new one due in the same jump.
 */

type Unsubscribe = () => void;
type ScheduleCallback = () => void | Promise<void>;

export interface Clock {
  now(): Date;
  /**
   * Fire `cb` when the clock reaches `at`. Returns an unsubscribe handle.
   * `cb` may be async; under AdjustableClock's drain loop it is awaited so
   * the bus's depth-counter unwinds between consecutive fires.
   */
  scheduleAt(at: Date, cb: ScheduleCallback): Unsubscribe;
}

const MAX_TIMEOUT_MS = 2_147_483_000; // ~24.8 days, safely under 2^31

export class WallClock implements Clock {
  now(): Date {
    return new Date();
  }

  scheduleAt(at: Date, cb: ScheduleCallback): Unsubscribe {
    const delay = at.getTime() - Date.now();
    if (delay <= 0) {
      // Already past — fire on the next macrotask so callers don't observe
      // a synchronous fire mid-construction.
      const handle = setImmediate(cb);
      return () => clearImmediate(handle);
    }
    if (delay > MAX_TIMEOUT_MS) {
      // setTimeout caps at 2^31 ms. Re-schedule from the wakeup point.
      let inner: NodeJS.Timeout | null = null;
      const wakeup = setTimeout(() => {
        inner = (this.scheduleAt(at, cb) as unknown) as NodeJS.Timeout;
      }, MAX_TIMEOUT_MS);
      return () => {
        clearTimeout(wakeup);
        if (inner) clearTimeout(inner);
      };
    }
    const timer = setTimeout(cb, delay);
    return () => clearTimeout(timer);
  }
}

interface ScheduledCallback {
  id: number;
  at: Date;
  cb: ScheduleCallback;
}

export class AdjustableClock implements Clock {
  private current: Date;
  private scheduled: ScheduledCallback[] = [];
  private nextId = 0;
  // Safety bound for the drain loop in `advanceTo` — guards against a buggy
  // cb that always re-schedules itself within the same jump.
  private static readonly DRAIN_SAFETY_BOUND = 100_000;

  constructor(initial: Date) {
    this.current = new Date(initial.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  scheduleAt(at: Date, cb: ScheduleCallback): Unsubscribe {
    const id = ++this.nextId;
    this.scheduled.push({ id, at: new Date(at.getTime()), cb });
    return () => {
      this.scheduled = this.scheduled.filter((s) => s.id !== id);
    };
  }

  /**
   * Advance the clock to `target`. Fires every scheduled callback whose `at`
   * is ≤ target, in chronological order. Awaits each cb so the bus's
   * depth-counter unwinds between consecutive fires (otherwise consecutive
   * `void bus.emit(...)` calls accumulate depth and trip the recursion guard
   * after a handful of iterations).
   *
   * Re-checks the schedule after each cb so a re-arming cb (typical for
   * schedulers) chains correctly within the same advance.
   *
   * Monotonic: a target ≤ current is a no-op.
   */
  async advanceTo(target: Date): Promise<void> {
    if (target.getTime() <= this.current.getTime()) return;
    this.current = new Date(target.getTime());

    for (let safety = 0; safety < AdjustableClock.DRAIN_SAFETY_BOUND; safety++) {
      let dueIndex = -1;
      let dueAt = Infinity;
      for (let i = 0; i < this.scheduled.length; i++) {
        const s = this.scheduled[i]!;
        const t = s.at.getTime();
        if (t <= this.current.getTime() && t < dueAt) {
          dueAt = t;
          dueIndex = i;
        }
      }
      if (dueIndex === -1) return;

      const due = this.scheduled[dueIndex]!;
      this.scheduled.splice(dueIndex, 1);
      await due.cb();
    }
    throw new Error(
      `AdjustableClock.advanceTo: drained ${AdjustableClock.DRAIN_SAFETY_BOUND} ` +
        `callbacks without exhausting the schedule. Probable re-schedule loop.`,
    );
  }

  /** Diagnostic: count of pending callbacks. */
  pendingCount(): number {
    return this.scheduled.length;
  }
}
