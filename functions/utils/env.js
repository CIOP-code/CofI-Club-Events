/**
 * Requires a secret/env var to be configured, instead of silently falling back to a value
 * hardcoded in this (public) repo. A deployment that forgot to run
 * `wrangler pages secret put <key>` would otherwise accept forged admin tokens (JWT_SECRET) or
 * log in as admin with a publicly-known default password (ADMIN_PASSWORD) — both work exactly
 * once, then fail loudly here so the misconfiguration is caught at request time instead of
 * staying invisible.
 */
export function requireEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(
      `Server misconfigured: ${key} is not set. Configure it with ` +
      `"wrangler pages secret put ${key}" (production) or a .dev.vars file (local dev).`
    );
  }
  return value;
}
