/**
 * POST /api/auth/admin  – login as the College of Idaho Admin
 * Body: { password }
 * Returns: { token }
 *
 * If no admin row exists in D1, the first call with the correct ADMIN_PASSWORD
 * env var will bootstrap the admin account.
 */
import { verifyPassword, hashPassword, generateSalt } from '../../utils/crypto.js';
import { signToken } from '../../utils/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { password } = body;
  if (!password) return json({ error: 'password is required' }, 400);

  const jwtSecret = env.JWT_SECRET || 'change-this-secret-in-production';
  const envAdminPassword = env.ADMIN_PASSWORD || 'CollegeOfIdaho2024!';

  try {
    let admin = await env.DB.prepare('SELECT * FROM admin WHERE id = 1').first();

    if (!admin) {
      // Bootstrap: create admin with the env-defined default password
      if (password !== envAdminPassword) {
        return json({ error: 'Incorrect password' }, 401);
      }
      const salt = generateSalt();
      const password_hash = await hashPassword(password, salt);
      await env.DB.prepare(
        'INSERT INTO admin (id, password_hash, salt) VALUES (1, ?, ?)'
      ).bind(password_hash, salt).run();
      const token = await signToken({ type: 'admin' }, jwtSecret);
      return json({ token, message: 'Admin account created and logged in' });
    }

    const valid = await verifyPassword(password, admin.password_hash, admin.salt);
    if (!valid) return json({ error: 'Incorrect password' }, 401);

    const token = await signToken({ type: 'admin' }, jwtSecret);
    return json({ token });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
