/**
 * GET    /api/events/:id  – get a single event
 * PUT    /api/events/:id  – update an event (requires owner entity or admin)
 * DELETE /api/events/:id  – delete an event (requires owner entity or admin)
 */
import { findLocationConflict, locationConflictMessage } from '../../utils/scheduling.js';

const EVENT_TYPES = ['meeting', 'social', 'academic', 'athletic', 'fundraiser', 'performance', 'other'];

function isValidJoinUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env, params }) {
  const { id } = params;
  try {
    const event = await env.DB.prepare(
      `SELECT e.*, en.name AS entity_name, en.type AS entity_type, l.name AS location_name
       FROM events e
       JOIN entities en ON e.entity_id = en.id
       LEFT JOIN locations l ON e.location_id = l.id
       WHERE e.id = ?`
    ).bind(id).first();
    if (!event) return json({ error: 'Event not found' }, 404);
    return json({ event });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export async function onRequestPut({ env, request, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  if (!event) return json({ error: 'Event not found' }, 404);

  if (user.type === 'entity' && user.entity_id !== event.entity_id) {
    return json({ error: 'Forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { title, description, start_datetime, end_datetime, event_type } = body;
  // location_id/join_url are both nullable (an event can have no location and/or no join link),
  // so a request that explicitly sends null means "clear it" and must be distinguished from a
  // field the caller simply omitted.
  const nextLocationId = 'location_id' in body ? body.location_id : event.location_id;
  const nextJoinUrl = 'join_url' in body ? (body.join_url || '').trim() : event.join_url;
  const nextStart = start_datetime ?? event.start_datetime;
  const nextEnd = end_datetime ?? event.end_datetime;

  if (new Date(nextEnd) <= new Date(nextStart)) {
    return json({ error: 'end_datetime must be after start_datetime' }, 400);
  }
  if (event_type && !EVENT_TYPES.includes(event_type)) {
    return json({ error: `event_type must be one of: ${EVENT_TYPES.join(', ')}` }, 400);
  }
  if (!isValidJoinUrl(nextJoinUrl)) {
    return json({ error: 'join_url must be a valid http:// or https:// link' }, 400);
  }

  try {
    const conflict = await findLocationConflict(env, {
      location_id: nextLocationId,
      start_datetime: nextStart,
      end_datetime: nextEnd,
      excludeEventId: id,
    });
    if (conflict) return json({ error: locationConflictMessage(conflict) }, 409);

    await env.DB.prepare(
      `UPDATE events SET title=?, description=?, location_id=?, start_datetime=?, end_datetime=?, event_type=?, join_url=? WHERE id = ?`
    ).bind(
      title ?? event.title,
      description ?? event.description,
      nextLocationId,
      nextStart,
      nextEnd,
      event_type ?? event.event_type,
      nextJoinUrl || null,
      id
    ).run();
    return json({ message: 'Event updated' });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export async function onRequestDelete({ env, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  if (!event) return json({ error: 'Event not found' }, 404);

  if (user.type === 'entity' && user.entity_id !== event.entity_id) {
    return json({ error: 'Forbidden' }, 403);
  }

  try {
    await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    return json({ message: 'Event deleted' });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
