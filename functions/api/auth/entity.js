/**
 * POST /api/auth/entity  – log in as an entity (club, department, office, organization)
 * Body: { entity_id, password }
 * Returns: { token, entity: { id, name, type } }
 */
import { verifyPassword } from '../../utils/crypto.js';
import { signToken } from '../../utils/jwt.js';
import { requireEnv } from '../../utils/env.js';
import { checkRateLimit, recordFailedAttempt } from '../../utils/rateLimit.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { entity_id, password } = body;
  if (!entity_id || !password) {
    return json({ error: 'entity_id and password are required' }, 400);
  }

  // Fails open (lets the attempt through) rather than blocking login entirely if the
  // login_attempts table hasn't been migrated in yet — see schema.sql.
  let ip = null;
  try {
    const rl = await checkRateLimit(env, request, 'entity');
    ip = rl.ip;
    if (!rl.allowed) {
      return json({ error: 'Too many failed login attempts. Try again in a few minutes.' }, 429);
    }
  } catch { /* rate limiting unavailable; don't block login on it */ }

  try {
    const entity = await env.DB.prepare(
      `SELECT id, name, type, password_hash, salt, must_change_password FROM entities WHERE id = ?`
    ).bind(entity_id).first();

    if (!entity) {
      if (ip) await recordFailedAttempt(env, ip, 'entity').catch(() => {});
      return json({ error: 'Entity not found' }, 404);
    }

    const valid = await verifyPassword(password, entity.password_hash, entity.salt);
    if (!valid) {
      if (ip) await recordFailedAttempt(env, ip, 'entity').catch(() => {});
      return json({ error: 'Incorrect password' }, 401);
    }

    const secret = requireEnv(env, 'JWT_SECRET');
    const token = await signToken({ type: 'entity', entity_id: entity.id, entity_name: entity.name }, secret);

    return json({
      token,
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        must_change_password: !!entity.must_change_password,
      },
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
