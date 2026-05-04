/**
 * POST /api/auth/club  – login as a club user
 * Body: { club_id, password }
 * Returns: { token, club: { id, name, logo_key } }
 */
import { verifyPassword } from '../../../utils/crypto.js';
import { signToken } from '../../../utils/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { club_id, password } = body;
  if (!club_id || !password) {
    return json({ error: 'club_id and password are required' }, 400);
  }

  try {
    const club = await env.DB.prepare(
      `SELECT id, name, logo_key, password_hash, salt FROM clubs WHERE id = ?`
    ).bind(club_id).first();

    if (!club) return json({ error: 'Club not found' }, 404);

    const valid = await verifyPassword(password, club.password_hash, club.salt);
    if (!valid) return json({ error: 'Incorrect password' }, 401);

    const secret = env.JWT_SECRET || 'change-this-secret-in-production';
    const token = await signToken({ type: 'club', club_id: club.id, club_name: club.name }, secret);

    return json({
      token,
      club: { id: club.id, name: club.name, logo_key: club.logo_key },
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
