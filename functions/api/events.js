/**
 * GET  /api/events?start=&end=   – list events (with optional date range filter)
 * POST /api/events                – create a new event (requires club or admin auth)
 */
import { signToken } from '../../utils/jwt.js';

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
    SELECT e.*, c.name AS club_name, c.logo_key
    FROM events e
    JOIN clubs c ON e.club_id = c.id
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
  if (!user || (user.type !== 'club' && user.type !== 'admin')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { title, description, poster_key, start_datetime, end_datetime } = body;
  if (!title || !start_datetime || !end_datetime) {
    return json({ error: 'title, start_datetime, and end_datetime are required' }, 400);
  }

  // Admin can specify any club_id; club users use their own club_id
  const club_id = user.type === 'admin' ? (body.club_id || 0) : user.club_id;
  if (!club_id) {
    return json({ error: 'club_id is required' }, 400);
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO events (title, description, poster_key, start_datetime, end_datetime, club_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(title, description || '', poster_key || null, start_datetime, end_datetime, club_id).run();

    return json({ id: result.meta.last_row_id, message: 'Event created' }, 201);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
