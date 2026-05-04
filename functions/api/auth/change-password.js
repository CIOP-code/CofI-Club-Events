/**
 * POST /api/auth/change-password
 * Body: { current_password, new_password }
 * Requires club auth token.
 */
import { verifyPassword, hashPassword, generateSalt } from '../../../utils/crypto.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ env, request, data }) {
  const user = data?.user;
  if (!user || user.type !== 'club') {
    return json({ error: 'Unauthorized – club login required' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { current_password, new_password } = body;
  if (!current_password || !new_password) {
    return json({ error: 'current_password and new_password are required' }, 400);
  }
  if (new_password.length < 6) {
    return json({ error: 'New password must be at least 6 characters' }, 400);
  }

  try {
    const club = await env.DB.prepare(
      'SELECT password_hash, salt FROM clubs WHERE id = ?'
    ).bind(user.club_id).first();

    if (!club) return json({ error: 'Club not found' }, 404);

    const valid = await verifyPassword(current_password, club.password_hash, club.salt);
    if (!valid) return json({ error: 'Current password is incorrect' }, 401);

    const newSalt = generateSalt();
    const newHash = await hashPassword(new_password, newSalt);

    await env.DB.prepare(
      'UPDATE clubs SET password_hash = ?, salt = ? WHERE id = ?'
    ).bind(newHash, newSalt, user.club_id).run();

    return json({ message: 'Password changed successfully' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
