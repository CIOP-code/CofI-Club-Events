/**
 * POST /api/auth/entity  – log in as an entity (club, department, office, organization)
 * Body: { entity_id, password }
 * Returns: { token, entity: { id, name, type } }
 */
import { verifyPassword } from '../../utils/crypto.js';
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

  const { entity_id, password } = body;
  if (!entity_id || !password) {
    return json({ error: 'entity_id and password are required' }, 400);
  }

  try {
    const entity = await env.DB.prepare(
      `SELECT id, name, type, password_hash, salt FROM entities WHERE id = ?`
    ).bind(entity_id).first();

    if (!entity) return json({ error: 'Entity not found' }, 404);

    const valid = await verifyPassword(password, entity.password_hash, entity.salt);
    if (!valid) return json({ error: 'Incorrect password' }, 401);

    const secret = env.JWT_SECRET || 'change-this-secret-in-production';
    const token = await signToken({ type: 'entity', entity_id: entity.id, entity_name: entity.name }, secret);

    return json({ token, entity: { id: entity.id, name: entity.name, type: entity.type } });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
