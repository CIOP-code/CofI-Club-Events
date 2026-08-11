/**
 * PUT    /api/locations/:id  – rename a location (requires entity or admin auth, matching who
 *                               can create one)
 * DELETE /api/locations/:id  – delete a location (admin only, since it's a shared resource other
 *                               entities' events may reference; ON DELETE SET NULL on
 *                               events.location_id means this can't destroy event data)
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPut({ env, request, params, data }) {
  const user = data?.user;
  if (!user || (user.type !== 'entity' && user.type !== 'admin')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { id } = params;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { name } = body;
  if (!name || !name.trim()) return json({ error: 'name is required' }, 400);

  try {
    await env.DB.prepare(`UPDATE locations SET name = ? WHERE id = ?`).bind(name.trim(), id).run();
    return json({ message: 'Location updated' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return json({ error: 'A location with that name already exists' }, 409);
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export async function onRequestDelete({ env, params, data }) {
  const user = data?.user;
  if (!user || user.type !== 'admin') return json({ error: 'Unauthorized – admin only' }, 401);

  const { id } = params;
  try {
    await env.DB.prepare('DELETE FROM locations WHERE id = ?').bind(id).run();
    return json({ message: 'Location deleted' });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
