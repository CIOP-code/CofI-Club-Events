/**
 * Login-attempt rate limiting backed by D1. Workers/Pages Functions don't keep in-memory state
 * across requests (each invocation can land on a fresh isolate), so an in-memory counter
 * wouldn't reliably catch repeated attempts — this persists attempts in D1 instead.
 *
 * This is an app-level backstop, not a replacement for Cloudflare's edge-level Rate Limiting
 * Rules (see SECURITY.md) — those reject abusive traffic before it reaches this code at all and
 * are the recommended primary defense; this covers the case where that hasn't been configured.
 */
const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 8;

function getClientIp(request) {
  // CF-Connecting-IP is set by Cloudflare's edge from the real TCP connection and can't be
  // spoofed by the client. Falls back for local dev, where wrangler pages dev doesn't set it.
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local-dev';
}

/**
 * Returns { ip, allowed }. Call before checking the submitted password.
 */
export async function checkRateLimit(env, request, endpoint) {
  const ip = getClientIp(request);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND endpoint = ? AND attempted_at > datetime('now', ?)`
  ).bind(ip, endpoint, `-${WINDOW_MINUTES} minutes`).first();

  return { ip, allowed: (row?.n || 0) < MAX_ATTEMPTS };
}

/**
 * Call after a failed login (wrong password, unknown entity, etc.).
 */
export async function recordFailedAttempt(env, ip, endpoint) {
  await env.DB.prepare(
    `INSERT INTO login_attempts (ip, endpoint) VALUES (?, ?)`
  ).bind(ip, endpoint).run();
  // Opportunistic cleanup so this table doesn't grow unbounded; cheap at this app's traffic scale.
  await env.DB.prepare(
    `DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-1 day')`
  ).run();
}
