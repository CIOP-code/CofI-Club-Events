/**
 * Password hashing utilities using PBKDF2 via the Web Crypto API.
 */

function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a random hex salt.
 */
export function generateSalt(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return arrayBufferToHex(bytes.buffer);
}

/**
 * Hash a password with PBKDF2-SHA256.
 * @param {string} password
 * @param {string} salt  hex string
 * @returns {Promise<string>}  hex hash
 */
export async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const saltBytes = new Uint8Array(salt.match(/.{2}/g).map(h => parseInt(h, 16)));

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  return arrayBufferToHex(derivedBits);
}

/**
 * Verify a password against a stored hash + salt.
 * @param {string} password
 * @param {string} hash  hex hash
 * @param {string} salt  hex salt
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash, salt) {
  const computed = await hashPassword(password, salt);
  return constantTimeEqual(computed, hash);
}

/** Constant-time string comparison, to avoid timing side-channels on any secret comparison. */
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Plain SHA-256 hex digest -- for hashing high-entropy random tokens (e.g. password reset
 * tokens), where PBKDF2's deliberate slowness (meant to blunt brute-forcing a *guessable*
 * user-chosen password) buys nothing: a 32-byte random token already has far more entropy than
 * any brute-force search could cover, so a single fast hash is enough to keep the raw token out
 * of the database while still letting a lookup by hash work.
 */
export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return arrayBufferToHex(digest);
}

/** Random hex token generator -- distinct name from generateSalt() even though the
 *  implementation is identical, since a reset token and a password salt serve different roles
 *  and conflating the names would be confusing at call sites. */
export function generateRandomToken(length = 32) {
  return generateSalt(length);
}
