/**
 * GET    /api/events/:id  – get a single event
 * PUT    /api/events/:id  – update an event (requires owner club or admin)
 * DELETE /api/events/:id  – delete an event (requires owner club or admin)
 */
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
      `SELECT e.*, c.name AS club_name, c.logo_key
       FROM events e JOIN clubs c ON e.club_id = c.id
       WHERE e.id = ?`
    ).bind(id).first();
    if (!event) return json({ error: 'Event not found' }, 404);
    return json({ event });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPut({ env, request, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  if (!event) return json({ error: 'Event not found' }, 404);

  if (user.type === 'club' && user.club_id !== event.club_id) {
    return json({ error: 'Forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { title, description, poster_key, start_datetime, end_datetime } = body;
  try {
    await env.DB.prepare(
      `UPDATE events SET title=?, description=?, poster_key=?, start_datetime=?, end_datetime=? WHERE id=?`
    ).bind(
      title ?? event.title,
      description ?? event.description,
      poster_key ?? event.poster_key,
      start_datetime ?? event.start_datetime,
      end_datetime ?? event.end_datetime,
      id
    ).run();
    return json({ message: 'Event updated' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ env, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  if (!event) return json({ error: 'Event not found' }, 404);

  if (user.type === 'club' && user.club_id !== event.club_id) {
    return json({ error: 'Forbidden' }, 403);
  }

  try {
    await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    return json({ message: 'Event deleted' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
