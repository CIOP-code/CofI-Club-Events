/**
 * Recurring-event date math. Materializes a bounded list of concrete instances up front
 * (rather than expanding a recurrence rule on every read) -- each instance is a normal row in
 * `events`, sharing a `series_id` and an identical `recurrence_rule` (JSON), which keeps every
 * existing query (GET /api/events, the calendar, the feed, PDF export...) working unchanged with
 * zero awareness that recurrence exists. The tradeoff is a hard cap on how far a series can run
 * (MAX_INSTANCES) instead of true infinite recurrence -- a deliberate simplicity choice, not an
 * oversight: nothing in this app's actual use case (campus club/office events) needs an
 * unbounded series, and capping avoids ever silently generating thousands of rows.
 */
export const MAX_INSTANCES = 52;
export const RECURRENCE_FREQS = ['weekly', 'monthly'];

function parseNaiveLocal(dtStr) {
  const m = String(dtStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +(s || 0) };
}

function formatNaiveLocal({ y, mo, d, h, mi, s }) {
  const pad = n => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
}

// These treat the naive local fields as if they were UTC calendar fields purely as a convenient,
// unambiguous calendar calculator (leap years, month lengths, etc.) -- never as a real timezone
// conversion. Both directions stay in this same "pretend UTC" domain consistently, so it never
// interacts with (or depends on) the Workers runtime's actual clock/zone.
function localToUtcMs(local) {
  return Date.UTC(local.y, local.mo - 1, local.d, local.h, local.mi, local.s);
}
function utcMsToLocal(ms) {
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds() };
}

function addWeeks(local, weeks) {
  return utcMsToLocal(localToUtcMs(local) + weeks * 7 * 86400000);
}

function daysInMonth(y, mo1indexed) {
  return new Date(Date.UTC(y, mo1indexed, 0)).getUTCDate(); // day 0 of next month = last day of this one
}

// Clamps to the target month's real last day (e.g. Jan 31 + 1 month -> Feb 28/29, not an
// overflowed "Mar 3") -- always computed from the ORIGINAL start date, not cumulatively from the
// previous occurrence, so a monthly series starting Jan 31 lands on the last day of every month
// (Feb 28, Mar 31, Apr 30...) instead of drifting downward once it first gets clamped.
function addMonthsClamped(local, months) {
  let mo = local.mo - 1 + months;
  const y = local.y + Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12 + 1;
  const d = Math.min(local.d, daysInMonth(y, mo));
  return { y, mo, d, h: local.h, mi: local.mi, s: local.s };
}

/**
 * Returns up to MAX_INSTANCES { start_datetime, end_datetime } pairs (naive local strings, same
 * format as everywhere else in this app), starting with the original start/end and continuing at
 * the given frequency/interval through `until` (an inclusive "YYYY-MM-DD" date), preserving the
 * original event's exact duration and time-of-day for every occurrence. Returns [] if the rule
 * or dates are invalid, or if `until` is before the start date (so callers can treat an empty
 * result as "nothing to create" and surface a clear validation error).
 */
export function generateRecurrenceInstances(startDtStr, endDtStr, { freq, interval = 1, until }) {
  const start = parseNaiveLocal(startDtStr);
  const end = parseNaiveLocal(endDtStr);
  if (!start || !end || !RECURRENCE_FREQS.includes(freq) || !until) return [];

  const untilLocal = parseNaiveLocal(`${until}T23:59:59`);
  if (!untilLocal) return [];
  const untilMs = localToUtcMs(untilLocal);

  const safeInterval = Math.max(1, parseInt(interval, 10) || 1);
  const durationMs = localToUtcMs(end) - localToUtcMs(start);

  const instances = [];
  for (let n = 0; n < MAX_INSTANCES; n++) {
    const occStart = freq === 'monthly'
      ? addMonthsClamped(start, n * safeInterval)
      : addWeeks(start, n * safeInterval);
    const occStartMs = localToUtcMs(occStart);
    if (occStartMs > untilMs) break;
    const occEnd = utcMsToLocal(occStartMs + durationMs);
    instances.push({ start_datetime: formatNaiveLocal(occStart), end_datetime: formatNaiveLocal(occEnd) });
  }
  return instances;
}
