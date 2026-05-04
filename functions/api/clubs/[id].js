/**
 * GET    /api/clubs/:id  – get a single club (public, no password hash returned)
 * PUT    /api/clubs/:id  – update a club (requires owner club or admin)
 * DELETE /api/clubs/:id  – delete a club (requires admin)
 */
import { generateSalt, hashPassword } from '../../../utils/crypto.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env, params }) {
  const { id } = params;
  try {
    const club = await env.DB.prepare(
      `SELECT id, name, logo_key, created_at FROM clubs WHERE id = ?`
    ).bind(id).first();
    if (!club) return json({ error: 'Club not found' }, 404);
    return json({ club });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPut({ env, request, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  if (user.type === 'club' && user.club_id !== parseInt(id)) {
    return json({ error: 'Forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { name, logo_key } = body;
  try {
    await env.DB.prepare(
      `UPDATE clubs SET name=COALESCE(?,name), logo_key=COALESCE(?,logo_key) WHERE id=?`
    ).bind(name || null, logo_key || null, id).run();
    return json({ message: 'Club updated' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ env, params, data }) {
  const user = data?.user;
  if (!user || user.type !== 'admin') return json({ error: 'Unauthorized – admin only' }, 401);

  const { id } = params;
  try {
    await env.DB.prepare('DELETE FROM clubs WHERE id = ?').bind(id).run();
    return json({ message: 'Club deleted' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
