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
  // Constant-time comparison
  if (computed.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}
