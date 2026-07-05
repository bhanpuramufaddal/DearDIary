/**
 * Persona-clock driver — test mode only.
 *
 * Anchors the AdjustableClock on mind's PROCESSING of webhook events, not on
 * their arrival. Concretely: subscribes to `mind.invocation.done` and, when
 * the triggering event was a webhook with an `occurred_at`, advances the
 * clock to that time.
 *
 * Why processing-anchored:
 *   The persona emulator dumps the entire timeline onto the bus in seconds,
 *   but mind drains the queue ~10 s/event. If the clock advanced on webhook
 *   arrival, it would jump 25 simulated days in 40 s while mind was still on
 *   event #3 — scheduler ticks (diary, reminders) would all fire against an
 *   empty substrate. Anchoring on `mind.invocation.done` keeps the clock
 *   walking at mind's actual pace, so by the time a diary tick fires the
 *   substrate already reflects that day's events.
 *
 * Monotonicity: AdjustableClock enforces "never rewind", so out-of-order
 * arrivals (a reply event whose occurred_at predates a previous one) don't
 * pull time backwards.
 *
 * Registered in boot.ts only when `DIGEST_TEST_CLOCK=persona` is set.
 */

import type { Bus } from '../bus.js';
import type { AdjustableClock } from '../clock.js';

const WEBHOOK_KINDS = new Set(['webhook.persona', 'webhook.gmail', 'webhook.gcal']);

export interface PersonaClockDriver {
  start(): void;
}

export function createPersonaClockDriver(
  bus: Bus,
  clock: AdjustableClock,
): PersonaClockDriver {
  return {
    start() {
      bus.on('mind.invocation.done', async (payload) => {
        const t = payload.triggering;
        if (!t || !t.occurred_at) return;
        if (!WEBHOOK_KINDS.has(t.kind)) return;
        const at = new Date(t.occurred_at);
        if (isNaN(at.getTime())) {
          console.warn(
            '[persona-clock] mind.invocation.done has unparseable triggering.occurred_at:',
            t.occurred_at,
          );
          return;
        }
        await clock.advanceTo(at);
      });
    },
  };
}
