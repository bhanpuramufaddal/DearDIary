/**
 * Timezone helpers.
 *
 * The principal's `config.timezone` is an IANA name (e.g. `America/Los_Angeles`).
 * Wall-clock times in `schedule.diary_times` are interpreted in that zone.
 *
 * We avoid pulling in a date library by leaning on `Intl.DateTimeFormat`:
 *   - format an instant into parts in a target zone, then
 *   - reinterpret those parts as UTC, take the difference → that's the offset.
 *
 * Good enough for daily scheduling. DST shifts are handled by recomputing
 * next-fire after each firing rather than caching offsets.
 */

/** Returns the offset, in minutes, of `timezone` at the moment `at`. */
export function timezoneOffsetMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const hour = m['hour'] === '24' ? '0' : (m['hour'] ?? '0');
  const asUtc = Date.UTC(
    Number(m['year']),
    Number(m['month']) - 1,
    Number(m['day']),
    Number(hour),
    Number(m['minute']),
    Number(m['second']),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/**
 * Compute the next future instant where the wall-clock time in `timezone`
 * equals `HH:MM`. Strictly greater than `after` (no clobber on the same instant).
 */
export function nextFireAt(timeHHMM: string, timezone: string, after: Date = new Date()): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(timeHHMM);
  if (!match) throw new Error(`invalid HH:MM: ${timeHHMM}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  function candidate(refDate: Date): Date {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(refDate);
    const m: Record<string, string> = {};
    for (const p of parts) m[p.type] = p.value;
    // Build the candidate as if it were UTC, then shift back by the offset of the target zone
    // at that moment to land on the correct UTC instant.
    const naiveUtc = Date.UTC(
      Number(m['year']),
      Number(m['month']) - 1,
      Number(m['day']),
      hours,
      minutes,
      0,
    );
    const offsetMin = timezoneOffsetMinutes(new Date(naiveUtc), timezone);
    return new Date(naiveUtc - offsetMin * 60_000);
  }

  let next = candidate(after);
  // If today's slot has already passed, roll to tomorrow.
  for (let i = 0; i < 2 && next <= after; i++) {
    next = candidate(new Date(after.getTime() + 86_400_000 * (i + 1)));
  }
  return next;
}
