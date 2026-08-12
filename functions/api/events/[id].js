/**
 * GET    /api/events/:id  – get a single event
 * PUT    /api/events/:id  – update an event (requires owner entity or admin)
 *                           optional body.apply_to: 'this' (default) | 'future' -- for a
 *                           recurring event, 'future' also propagates title/description/
 *                           location/event_type/join_url to every later event in the series
 *                           (each sibling keeps its own date/time; only the edited row's own
 *                           start/end can change)
 * DELETE /api/events/:id  – delete an event (requires owner entity or admin)
 *                           optional ?apply_to=future -- deletes this and every later event in
 *                           the same series
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

  // "This and following": every later row in the same series gets the shared content fields
  // (title/description/location/type/join_url), but keeps its own start/end -- only the row
  // actually being edited can have its date/time changed. Re-deriving a shifted recurrence
  // pattern (e.g. "move the whole future series to 7pm") is out of scope here; this covers the
  // more common case of fixing a title typo or swapping a location across an entire series.
  const applyToFuture = body.apply_to === 'future' && !!event.series_id;

  try {
    const conflict = await findLocationConflict(env, {
      location_id: nextLocationId,
      start_datetime: nextStart,
      end_datetime: nextEnd,
      excludeEventId: id,
    });
    if (conflict) return json({ error: locationConflictMessage(conflict) }, 409);

    let futureSiblings = [];
    if (applyToFuture) {
      futureSiblings = (await env.DB.prepare(
        `SELECT id, start_datetime, end_datetime FROM events WHERE series_id = ? AND id != ? AND start_datetime >= ?`
      ).bind(event.series_id, id, event.start_datetime).all()).results;

      // A location change has to be re-checked against every sibling's OWN date/time, since they
      // keep their own schedule -- only the content fields propagate, not the clock. All-or-
      // nothing, same as creating the series in the first place.
      if (nextLocationId !== event.location_id) {
        for (const sib of futureSiblings) {
          const sibConflict = await findLocationConflict(env, {
            location_id: nextLocationId,
            start_datetime: sib.start_datetime,
            end_datetime: sib.end_datetime,
            excludeEventId: sib.id,
          });
          if (sibConflict) {
            return json({ error: `${locationConflictMessage(sibConflict)} (on ${sib.start_datetime.slice(0, 10)})` }, 409);
          }
        }
      }
    }

    const stmts = [
      env.DB.prepare(
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
      ),
    ];

    for (const sib of futureSiblings) {
      stmts.push(env.DB.prepare(
        `UPDATE events SET title=?, description=?, location_id=?, event_type=?, join_url=? WHERE id = ?`
      ).bind(
        title ?? event.title,
        description ?? event.description,
        nextLocationId,
        event_type ?? event.event_type,
        nextJoinUrl || null,
        sib.id
      ));
    }

    await env.DB.batch(stmts);
    return json({
      message: applyToFuture
        ? `Updated this and ${futureSiblings.length} future event${futureSiblings.length === 1 ? '' : 's'}`
        : 'Event updated',
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export async function onRequestDelete({ env, params, data, request }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  if (!event) return json({ error: 'Event not found' }, 404);

  if (user.type === 'entity' && user.entity_id !== event.entity_id) {
    return json({ error: 'Forbidden' }, 403);
  }

  const url = new URL(request.url);
  const applyToFuture = url.searchParams.get('apply_to') === 'future' && !!event.series_id;

  try {
    if (applyToFuture) {
      // start_datetime >= event.start_datetime includes this row itself, so one statement
      // covers "this and every later event in the series."
      const result = await env.DB.prepare(
        `DELETE FROM events WHERE series_id = ? AND start_datetime >= ?`
      ).bind(event.series_id, event.start_datetime).run();
      return json({ message: `Deleted ${result.meta.changes} event${result.meta.changes === 1 ? '' : 's'}` });
    }

    await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    return json({ message: 'Event deleted' });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
