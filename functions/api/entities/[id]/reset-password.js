/**
 * POST /api/entities/:id/reset-password  – admin resets an entity's password
 * Requires admin auth. Generates a fresh random temporary password, stores only
 * its hash, forces the entity to change it on next login, and returns the
 * plaintext temp password once so the admin can hand it off out-of-band. It is
 * never stored or logged anywhere.
 */
import { generateSalt, hashPassword } from '../../../utils/crypto.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Avoids visually ambiguous characters (0/O, 1/l/I) since this password is often relayed by
// reading it aloud or over text/email to whoever is taking over the entity.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generateTempPassword(length = 12) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => TEMP_PASSWORD_ALPHABET[b % TEMP_PASSWORD_ALPHABET.length]).join('');
}

export async function onRequestPost({ env, params, data }) {
  const user = data?.user;
  if (!user || user.type !== 'admin') {
    return json({ error: 'Unauthorized – admin only' }, 401);
  }

  const { id } = params;
  try {
    const entity = await env.DB.prepare('SELECT id, name FROM entities WHERE id = ?').bind(id).first();
    if (!entity) return json({ error: 'Entity not found' }, 404);

    const tempPassword = generateTempPassword();
    const salt = generateSalt();
    const password_hash = await hashPassword(tempPassword, salt);

    await env.DB.prepare(
      'UPDATE entities SET password_hash = ?, salt = ?, must_change_password = 1 WHERE id = ?'
    ).bind(password_hash, salt, id).run();

    return json({
      message: `Password reset for ${entity.name}`,
      entity: { id: entity.id, name: entity.name },
      temp_password: tempPassword,
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
