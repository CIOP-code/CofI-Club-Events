/**
 * GET    /api/entities/:id  – get a single entity (public, no password hash returned)
 * PUT    /api/entities/:id  – update an entity (requires owner entity or admin)
 * DELETE /api/entities/:id  – delete an entity (requires admin)
 */
const VALID_TYPES = ['club', 'department', 'office', 'organization'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env, params }) {
  const { id } = params;
  try {
    const entity = await env.DB.prepare(
      `SELECT id, name, type, created_at FROM entities WHERE id = ?`
    ).bind(id).first();
    if (!entity) return json({ error: 'Entity not found' }, 404);
    return json({ entity });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPut({ env, request, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  if (user.type === 'entity' && user.entity_id !== parseInt(id)) {
    return json({ error: 'Forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { name, type } = body;
  if (type && !VALID_TYPES.includes(type)) {
    return json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, 400);
  }

  try {
    await env.DB.prepare(
      `UPDATE entities SET name=COALESCE(?,name), type=COALESCE(?,type) WHERE id=?`
    ).bind(name || null, type || null, id).run();
    return json({ message: 'Entity updated' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ env, params, data }) {
  const user = data?.user;
  if (!user || user.type !== 'admin') return json({ error: 'Unauthorized – admin only' }, 401);

  const { id } = params;
  try {
    await env.DB.prepare('DELETE FROM entities WHERE id = ?').bind(id).run();
    return json({ message: 'Entity deleted' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
