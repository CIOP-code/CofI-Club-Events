/**
 * Shared iCalendar (RFC 5545) building blocks, used by both the single-event download
 * (functions/api/events/[id]/ics.js) and the subscribable filtered feed
 * (functions/api/feed.ics.js) so the two never drift on date/escaping/line-folding logic.
 */
export function icsEscape(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// start_datetime/end_datetime are stored as naive "YYYY-MM-DDTHH:MM[:SS]" strings with no
// timezone, representing College of Idaho local wall-clock time (same assumption the rest of the
// app makes when it does `new Date(ev.start_datetime)` in the browser).
//
// Earlier versions emitted DTSTART/DTEND as `TZID=America/Boise:...`, first with no VTIMEZONE
// definition at all (Outlook: "Couldn't import calendar" — Google/Apple tolerate a bare IANA
// TZID, Outlook doesn't), then with one added (Outlook: "content conversion failed" — still
// unhappy). Rather than chase further Outlook-specific VTIMEZONE quirks, this converts the
// wall-clock time to a real UTC instant and emits plain `...Z` timestamps instead, which every
// calendar client (Outlook included) supports unambiguously with zero timezone-database
// dependency. The DST math below is verified against Node's real America/Boise tzdata.
function parseNaiveLocal(dtStr) {
  const m = String(dtStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +(s || 0) };
}

function nthSundayOfMonth(year, month, n) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const firstSunday = firstDow === 0 ? 1 : 8 - firstDow;
  return firstSunday + (n - 1) * 7;
}

// US DST rule (since 2007): starts 2nd Sunday of March, ends 1st Sunday of November, both at
// 2:00am local. Mountain Time is UTC-7 standard (MST) / UTC-6 daylight (MDT).
function boiseUtcOffsetMinutes({ y, mo, d, h, mi }) {
  const dstStartDay = nthSundayOfMonth(y, 3, 2);
  const dstEndDay = nthSundayOfMonth(y, 11, 1);
  const asNum = (mo_, d_, h_, mi_) => mo_ * 1000000 + d_ * 10000 + h_ * 100 + mi_;
  const current = asNum(mo, d, h, mi);
  const isDst = current >= asNum(3, dstStartDay, 2, 0) && current < asNum(11, dstEndDay, 2, 0);
  return isDst ? -6 * 60 : -7 * 60;
}

function formatUtcDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function toIcsUtc(dtStr) {
  const local = parseNaiveLocal(dtStr);
  if (!local) return null;
  const offsetMin = boiseUtcOffsetMinutes(local);
  const utcMs = Date.UTC(local.y, local.mo - 1, local.d, local.h, local.mi, local.s) - offsetMin * 60000;
  return formatUtcDate(new Date(utcMs));
}

// DTSTAMP is "when this file was generated" and is already a true UTC instant (unlike
// start_datetime/end_datetime, which are naive Boise-local strings) — format it directly, don't
// run it through toIcsUtc's local->UTC conversion or it gets shifted twice.
export function toIcsUtcNow() {
  return formatUtcDate(new Date());
}

// RFC 5545 requires lines to be folded at 75 octets, with continuation lines starting with a
// single space. Outlook is stricter about this than Google/Apple and can fail on long
// unfolded SUMMARY/DESCRIPTION lines.
export function foldLine(line) {
  const max = 75;
  if (line.length <= max) return line;
  let result = line.slice(0, max);
  let rest = line.slice(max);
  while (rest.length > 0) {
    result += '\r\n ' + rest.slice(0, max - 1);
    rest = rest.slice(max - 1);
  }
  return result;
}

/**
 * Builds the BEGIN:VEVENT..END:VEVENT lines (unfolded) for one event row. hostname is used for
 * the UID's domain part, same scheme (event-<id>@<hostname>) whether this is the single-event
 * download or one entry in the multi-event feed, so a client that already has a copy from one
 * source recognizes the same event from the other rather than double-booking it.
 */
export function buildVEventLines(event, hostname, dtStamp) {
  const dtStart = toIcsUtc(event.start_datetime);
  const dtEnd = toIcsUtc(event.end_datetime);
  // LOCATION always gets something sensible even for a fully virtual event (no location_name at
  // all) rather than being omitted; URL is the machine-actionable join link most calendar clients
  // render as a clickable button, separate from the human-readable LOCATION text.
  const locationText = event.location_name
    ? (event.join_url ? `${event.location_name} (also virtual)` : event.location_name)
    : (event.join_url ? 'Virtual' : null);
  return [
    'BEGIN:VEVENT',
    `UID:event-${event.id}@${hostname}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(event.title)}`,
    event.description ? `DESCRIPTION:${icsEscape(event.description)}` : null,
    locationText ? `LOCATION:${icsEscape(locationText)}` : null,
    event.join_url ? `URL:${icsEscape(event.join_url)}` : null,
    `CATEGORIES:${icsEscape(event.entity_name)}`,
    'END:VEVENT',
  ].filter(Boolean);
}

/** "event-42.ics" gives no clue what's inside until opened; slugify the title alongside the id. */
export function icsFilename(title, id) {
  const slug = String(title || 'event')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'event'}-${id}.ics`;
}
