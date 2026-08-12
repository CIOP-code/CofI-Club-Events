/**
 * GET /api/events/:id/ics – download a single event as an iCalendar (.ics) file
 */
import { buildVEventLines, foldLine, icsFilename, toIcsUtcNow } from '../../../utils/ics.js';

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

  const url = new URL(request.url);
  const dtStamp = toIcsUtcNow();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//College of Idaho Campus Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...buildVEventLines(event, url.hostname, dtStamp),
    'END:VCALENDAR',
  ].map(foldLine);

  return new Response(lines.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(event.title, event.id)}"`,
    },
  });
}
