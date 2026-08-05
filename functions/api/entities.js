/**
 * GET  /api/entities        – list all entities (clubs, departments, offices, organizations)
 * POST /api/entities        – create a new entity (requires admin auth)
 */
import { generateSalt, hashPassword } from '../utils/crypto.js';

const VALID_TYPES = ['club', 'department', 'office', 'organization'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env }) {
  try {
    const result = await env.DB.prepare(
      `SELECT id, name, type, created_at FROM entities ORDER BY name ASC`
    ).all();
    return json({ entities: result.results });
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

  const { name, password } = body;
  const entityType = body.type || 'club';
  if (!name || !password) {
    return json({ error: 'name and password are required' }, 400);
  }
  if (!VALID_TYPES.includes(entityType)) {
    return json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, 400);
  }

  const salt = generateSalt();
  const password_hash = await hashPassword(password, salt);

  try {
    const result = await env.DB.prepare(
      `INSERT INTO entities (name, type, password_hash, salt) VALUES (?, ?, ?, ?)`
    ).bind(name, entityType, password_hash, salt).run();
    return json({ id: result.meta.last_row_id, message: 'Entity created' }, 201);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return json({ error: 'An entity with that name already exists' }, 409);
    }
    return json({ error: err.message }, 500);
  }
}
