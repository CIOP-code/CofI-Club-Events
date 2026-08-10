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

// DTSTAMP is "when this file was generated" and must be a real UTC instant per RFC 5545.
function toIcsUtcNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// start_datetime/end_datetime are stored as naive "YYYY-MM-DDTHH:MM[:SS]" strings with no
// timezone, representing College of Idaho local wall-clock time (same assumption the rest of the
// app makes when it does `new Date(ev.start_datetime)` in the browser). Formatting the digits
// directly and tagging them TZID=America/Boise keeps that intended local time exact, instead of
// reinterpreting the string as UTC and shifting it by several hours.
function toIcsLocal(dtStr) {
  const m = String(dtStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}${mo}${d}T${h}${mi}${s || '00'}`;
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

  const dtStart = toIcsLocal(event.start_datetime);
  const dtEnd = toIcsLocal(event.end_datetime);
  const url = new URL(request.url);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//College of Idaho Campus Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-TIMEZONE:America/Boise',
    'BEGIN:VEVENT',
    `UID:event-${event.id}@${url.hostname}`,
    `DTSTAMP:${toIcsUtcNow()}`,
    `DTSTART;TZID=America/Boise:${dtStart}`,
    `DTEND;TZID=America/Boise:${dtEnd}`,
    `SUMMARY:${icsEscape(event.title)}`,
    event.description ? `DESCRIPTION:${icsEscape(event.description)}` : null,
    event.location_name ? `LOCATION:${icsEscape(event.location_name)}` : null,
    `CATEGORIES:${icsEscape(event.entity_name)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return new Response(lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="event-${event.id}.ics"`,
    },
  });
}
