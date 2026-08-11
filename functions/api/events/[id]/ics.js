/**
 * GET /api/events/:id/ics – download a single event as an iCalendar (.ics) file
 */
function icsEscape(str) {
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
// Earlier versions of this endpoint emitted DTSTART/DTEND as `TZID=America/Boise:...`, first with
// no VTIMEZONE definition at all (Outlook: "Couldn't import calendar" — Google/Apple tolerate a
// bare IANA TZID, Outlook doesn't), then with one added (Outlook: "content conversion failed" —
// still unhappy). Rather than chase further Outlook-specific VTIMEZONE quirks, this converts the
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

function toIcsUtc(dtStr) {
  const local = parseNaiveLocal(dtStr);
  if (!local) return null;
  const offsetMin = boiseUtcOffsetMinutes(local);
  const utcMs = Date.UTC(local.y, local.mo - 1, local.d, local.h, local.mi, local.s) - offsetMin * 60000;
  return formatUtcDate(new Date(utcMs));
}

function formatUtcDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// DTSTAMP is "when this file was generated" and is already a true UTC instant (unlike
// start_datetime/end_datetime, which are naive Boise-local strings) — format it directly, don't
// run it through toIcsUtc's local->UTC conversion or it gets shifted twice.
function toIcsUtcNow() {
  return formatUtcDate(new Date());
}

// RFC 5545 requires lines to be folded at 75 octets, with continuation lines starting with a
// single space. Outlook is stricter about this than Google/Apple and can fail on long
// unfolded SUMMARY/DESCRIPTION lines.
function foldLine(line) {
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

// "event-42.ics" gives no clue what's inside until opened. Slugify the title alongside the id
// so a folder full of downloaded invites is actually distinguishable at a glance.
function icsFilename(title, id) {
  const slug = String(title || 'event')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'event'}-${id}.ics`;
}

export async function onRequestGet({ env, params, request }) {
  const { id } = params;
  const event = await env.DB.prepare(
    `SELECT e.*, en.name AS entity_name, l.name AS location_name
     FROM events e
     JOIN entities en ON e.entity_id = en.id
     LEFT JOIN locations l ON e.location_id = l.id
     WHERE e.id = ?`
  ).bind(id).first();

  if (!event) return new Response('Event not found', { status: 404 });

  const dtStart = toIcsUtc(event.start_datetime);
  const dtEnd = toIcsUtc(event.end_datetime);
  const dtStamp = toIcsUtcNow();
  const url = new URL(request.url);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//College of Idaho Campus Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${event.id}@${url.hostname}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(event.title)}`,
    event.description ? `DESCRIPTION:${icsEscape(event.description)}` : null,
    event.location_name ? `LOCATION:${icsEscape(event.location_name)}` : null,
    `CATEGORIES:${icsEscape(event.entity_name)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).map(foldLine);

  return new Response(lines.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(event.title, event.id)}"`,
    },
  });
}
