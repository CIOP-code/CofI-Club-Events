/**
 * GET /api/feed.ics?entity_id=&event_type=&location_id=  – a subscribable iCalendar feed of all
 * upcoming events matching the given filters (same params as the calendar's own Filter modal).
 * No filters = every upcoming event. Public, no auth -- same visibility as browsing the calendar.
 *
 * Unlike the single-event download (functions/api/events/[id]/ics.js), a calendar app re-fetches
 * this URL on its own schedule, so it stays in sync automatically instead of going stale the
 * moment it's downloaded.
 */
import { buildVEventLines, foldLine, toIcsUtcNow } from '../utils/ics.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const entityId = url.searchParams.get('entity_id');
  const eventType = url.searchParams.get('event_type');
  const locationId = url.searchParams.get('location_id');

  let query = `
    SELECT e.*, en.name AS entity_name, l.name AS location_name
    FROM events e
    JOIN entities en ON e.entity_id = en.id
    LEFT JOIN locations l ON e.location_id = l.id
    WHERE e.start_datetime >= ?
  `;
  // Naive local "now" (no timezone suffix), matching how start_datetime/end_datetime are stored
  // and compared everywhere else in this app -- a lexicographic compare against the same naive
  // format, not a real UTC instant comparison.
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const nowLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const params = [nowLocal];

  if (entityId) { query += ' AND e.entity_id = ?'; params.push(entityId); }
  if (eventType) { query += ' AND e.event_type = ?'; params.push(eventType); }
  if (locationId) { query += ' AND e.location_id = ?'; params.push(locationId); }
  query += ' ORDER BY e.start_datetime ASC';

  try {
    const result = await env.DB.prepare(query).bind(...params).all();
    const dtStamp = toIcsUtcNow();

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//College of Idaho Campus Events//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      // A subscribed feed refreshing itself is exactly what this header is for -- clients that
      // honor it (mainly Outlook/desktop clients; Google/Apple pick their own refresh interval
      // regardless) won't poll more often than this.
      'X-PUBLISHED-TTL:PT1H',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      ...result.results.flatMap(event => buildVEventLines(event, url.hostname, dtStamp)),
      'END:VCALENDAR',
    ].map(foldLine);

    return new Response(lines.join('\r\n') + '\r\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="campus-events-feed.ics"',
      },
    });
  } catch (err) {
    console.error(err);
    return new Response('Internal server error', { status: 500 });
  }
}
