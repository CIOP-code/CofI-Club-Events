/**
 * Middleware for all /api/* routes.
 * Adds CORS headers and attaches the decoded JWT payload to context.data.user.
 */
import { verifyToken, extractToken } from '../utils/jwt.js';
import { requireEnv } from '../utils/env.js';

export async function onRequest(context) {
  const { request, env, next } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // Attach decoded user (if token present)
  const token = extractToken(request);
  if (token) {
    let secret;
    try {
      secret = requireEnv(env, 'JWT_SECRET');
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    context.data.user = await verifyToken(token, secret);
  }

  const response = await next();
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    newHeaders.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    headers: newHeaders,
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
