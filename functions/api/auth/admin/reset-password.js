/**
 * POST /api/auth/admin/reset-password
 * Body: { token, new_password }
 *
 * Public, no auth -- possession of the emailed token IS the authentication here, same pattern as
 * any "reset password" email link. Not rate-limited by IP the way forgot-password is: the token
 * itself is 256 bits of randomness, well beyond what any realistic guessing attempt could search
 * within its 30-minute window, so a per-IP throttle here would add complexity without adding
 * real protection.
 */
import { hashPassword, generateSalt, sha256Hex, constantTimeEqual } from '../../../utils/crypto.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { token, new_password } = body;
  if (!token || !new_password) {
    return json({ error: 'token and new_password are required' }, 400);
  }
  if (new_password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }

  try {
    const admin = await env.DB.prepare(
      'SELECT reset_token_hash, reset_token_expires FROM admin WHERE id = 1'
    ).first();

    if (!admin || !admin.reset_token_hash) {
      return json({ error: 'Invalid or expired reset link' }, 400);
    }
    if (new Date(admin.reset_token_expires) < new Date()) {
      return json({ error: 'This reset link has expired. Request a new one.' }, 400);
    }

    const incomingHash = await sha256Hex(token);
    if (!constantTimeEqual(incomingHash, admin.reset_token_hash)) {
      return json({ error: 'Invalid or expired reset link' }, 400);
    }

    const salt = generateSalt();
    const password_hash = await hashPassword(new_password, salt);

    // Clearing the token on use (not just on expiry) makes it genuinely single-use -- a second
    // attempt with the same link, even within the 30-minute window, fails the same way an
    // already-expired one would.
    await env.DB.prepare(
      'UPDATE admin SET password_hash = ?, salt = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = 1'
    ).bind(password_hash, salt).run();

    return json({ message: 'Password updated. You can log in now.' });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
