/**
 * GET  /api/clubs        – list all clubs
 * POST /api/clubs        – create a new club (requires admin auth)
 */
import { generateSalt, hashPassword } from '../../utils/crypto.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env }) {
  try {
    const result = await env.DB.prepare(
      `SELECT id, name, logo_key, created_at FROM clubs ORDER BY name ASC`
    ).all();
    return json({ clubs: result.results });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPost({ env, request, data }) {
  const user = data?.user;
  if (!user || user.type !== 'admin') {
    return json({ error: 'Unauthorized – admin only' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { name, logo_key, password } = body;
  if (!name || !password) {
    return json({ error: 'name and password are required' }, 400);
  }

  const salt = generateSalt();
  const password_hash = await hashPassword(password, salt);

  try {
    const result = await env.DB.prepare(
      `INSERT INTO clubs (name, logo_key, password_hash, salt) VALUES (?, ?, ?, ?)`
    ).bind(name, logo_key || null, password_hash, salt).run();
    return json({ id: result.meta.last_row_id, message: 'Club created' }, 201);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return json({ error: 'A club with that name already exists' }, 409);
    }
    return json({ error: err.message }, 500);
  }
}
