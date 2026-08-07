/**
 * GET  /api/events?start=&end=   – list events (with optional date range filter)
 * POST /api/events                – create a new event (requires entity or admin auth)
 */
import { findLocationConflict, locationConflictMessage } from '../utils/scheduling.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const end   = url.searchParams.get('end');

  let query = `
    SELECT e.*, en.name AS entity_name, en.type AS entity_type, l.name AS location_name
    FROM events e
    JOIN entities en ON e.entity_id = en.id
    LEFT JOIN locations l ON e.location_id = l.id
  `;
  const params = [];

  if (start && end) {
    query += ` WHERE e.start_datetime >= ? AND e.start_datetime <= ?`;
    params.push(start, end);
  } else if (start) {
    query += ` WHERE e.start_datetime >= ?`;
    params.push(start);
  }

  query += ` ORDER BY e.start_datetime ASC`;

  try {
    const result = await env.DB.prepare(query).bind(...params).all();
    return json({ events: result.results });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPost({ env, request, data }) {
  const user = data?.user;
  if (!user || (user.type !== 'entity' && user.type !== 'admin')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { title, description, location_id, start_datetime, end_datetime } = body;
  if (!title || !start_datetime || !end_datetime) {
    return json({ error: 'title, start_datetime, and end_datetime are required' }, 400);
  }

  // Admin can specify any entity_id; entity users use their own entity_id
  const entity_id = user.type === 'admin' ? (body.entity_id || 0) : user.entity_id;
  if (!entity_id) {
    return json({ error: 'entity_id is required' }, 400);
  }

  try {
    const conflict = await findLocationConflict(env, { location_id: location_id || null, start_datetime, end_datetime });
    if (conflict) return json({ error: locationConflictMessage(conflict) }, 409);

    const result = await env.DB.prepare(
      `INSERT INTO events (title, description, location_id, start_datetime, end_datetime, entity_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(title, description || '', location_id || null, start_datetime, end_datetime, entity_id).run();

    return json({ id: result.meta.last_row_id, message: 'Event created' }, 201);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
