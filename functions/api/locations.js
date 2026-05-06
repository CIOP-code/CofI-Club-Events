/**
 * GET  /api/locations   – list all locations
 * POST /api/locations   – create a new location (requires club or admin auth)
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env }) {
  try {
    const result = await env.DB.prepare(`SELECT id, name FROM locations ORDER BY name ASC`).all();
    return json({ locations: result.results });
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
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { name } = body;
  if (!name) return json({ error: 'name is required' }, 400);

  try {
    const result = await env.DB.prepare(
      `INSERT INTO locations (name) VALUES (?)`
    ).bind(name.trim()).run();
    return json({ id: result.meta.last_row_id, message: 'Location created' }, 201);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return json({ error: 'Location already exists' }, 409);
    return json({ error: err.message }, 500);
  }
}
