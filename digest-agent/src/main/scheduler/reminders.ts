/**
 * Reminder scheduler.
 *
 * Reads the earliest pending reminder from the `reminders` table, calls
 * `clock.scheduleAt(fires_at, fire)`, and on fire emits `reminder.fired`,
 * marks the row, and re-arms with the next earliest.
 *
 * Re-reads the table on `mind.invocation.done` — the mind agent may have
 * inserted, cancelled, or modified reminders during that invocation, and the
 * next-fire instant could have changed.
 *
 * Long delays handled by the clock's `scheduleAt` impl (WallClock chains
 * through the 24.8-day setTimeout cap; AdjustableClock fires synchronously
 * during `advanceTo`).
 *
 * Architecture: design/08-runtime.md § "Subsystem 3: reminder scheduler".
 */

import { makeRemindersRepo } from '../db/reminders.js';
import type { Bus } from '../bus.js';
import type { Db } from '../db/index.js';
import type { Clock } from '../clock.js';
import type { ReminderId } from '@shared/types/ids.js';

export interface ReminderScheduler {
  start(): void;
  stop(): void;
  /** Force a re-read of the table; used by tests and as a recovery hook. */
  refresh(): void;
  /** The reminder we're currently armed for, if any — for diagnostics and tests. */
  armedFor(): { id: ReminderId; fires_at: number } | null;
}

export interface ReminderSchedulerOptions {
  clock: Clock;
}

export function createReminderScheduler(
  db: Db,
  bus: Bus,
  opts: ReminderSchedulerOptions,
): ReminderScheduler {
  const reminders = makeRemindersRepo(db);
  const clock = opts.clock;

  let cancelArmed: (() => void) | null = null;
  let stopped = false;
  let armedFor: { id: ReminderId; fires_at: number } | null = null;

  function clearArmedTimer(): void {
    if (cancelArmed) {
      cancelArmed();
      cancelArmed = null;
    }
    armedFor = null;
  }

  function arm(): void {
    if (stopped) return;
    clearArmedTimer();
    const pending = reminders.pendingReminders();
    if (pending.length === 0) return;

    const earliest = pending[0]!;
    const firesAt = new Date(earliest.fires_at);
    armedFor = { id: earliest.id, fires_at: firesAt.getTime() };
    cancelArmed = clock.scheduleAt(firesAt, async () => {
      cancelArmed = null;
      armedFor = null;
      try {
        await fire(earliest.id);
      } catch (err) {
        console.error('[reminders] error firing reminder', earliest.id, err);
      }
      // Re-arm after the emit settles so the bus's depth counter unwinds
      // and the next fire's scheduleAt is registered before this cb returns.
      arm();
    });
  }

  async function fire(id: ReminderId): Promise<void> {
    const row = reminders.pendingReminders().find((r) => r.id === id);
    if (!row) return; // cancelled or already fired in the gap
    const firedAt = clock.now().toISOString();
    reminders.markFired(id, firedAt);
    const relatedAnchors = reminders.relatedAnchors(id);
    await bus.emit(
      'reminder.fired',
      {
        reminder_id: id,
        context: row.context,
        related_anchors: relatedAnchors,
        fires_at: row.fires_at,
      },
      { occurred_at: row.fires_at, observed_at: firedAt },
    );
  }

  return {
    start() {
      stopped = false;
      bus.on('mind.invocation.done', () => {
        arm();
      });
      arm();
    },
    stop() {
      stopped = true;
      clearArmedTimer();
    },
    refresh: arm,
    armedFor() {
      return armedFor;
    },
  };
}
