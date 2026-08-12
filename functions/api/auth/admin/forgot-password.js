/**
 * POST /api/auth/admin/forgot-password
 *
 * Public, no auth (that's the point — this is how you regain access when locked out). Emails a
 * one-time reset link to the admin's configured notify_email, if one is set. There's only ever
 * one admin account in this app, so there's no username/email to submit here -- the request body
 * is empty; this either sends to whatever's configured, or explains why it can't.
 */
import { generateRandomToken, sha256Hex } from '../../../utils/crypto.js';
import { sendEmail } from '../../../utils/email.js';
import { checkRateLimit, recordAttempt } from '../../../utils/rateLimit.js';

const RESET_TOKEN_TTL_MINUTES = 30;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ env, request }) {
  // Each request costs a real email send, so this gets the same D1-backed throttle as login
  // attempts and feedback submissions -- fails open if login_attempts isn't migrated in yet.
  let ip = null;
  try {
    const rl = await checkRateLimit(env, request, 'admin-forgot-password');
    ip = rl.ip;
    if (!rl.allowed) {
      return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
    }
  } catch { /* rate limiting unavailable; don't block the request on it */ }

  try {
    const admin = await env.DB.prepare('SELECT notify_email FROM admin WHERE id = 1').first();
    if (!admin) {
      return json({ error: 'No admin account exists yet — log in once with the initial password to create it.' }, 404);
    }
    if (!admin.notify_email) {
      return json({ error: 'No recovery email is configured for this admin account. Set one in Admin → Utilities → Notifications while still logged in, or ask whoever manages the Cloudflare deployment to reset it directly.' }, 400);
    }

    if (ip) await recordAttempt(env, ip, 'admin-forgot-password').catch(() => {});

    const rawToken = generateRandomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expires = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

    await env.DB.prepare(
      'UPDATE admin SET reset_token_hash = ?, reset_token_expires = ? WHERE id = 1'
    ).bind(tokenHash, expires).run();

    const resetUrl = `${new URL(request.url).origin}/?reset_token=${rawToken}`;

    try {
      await sendEmail(env, {
        to: admin.notify_email,
        subject: '[Campus Events] Admin password reset requested',
        text: `A password reset was requested for the Campus Events admin account.\n\n` +
              `Reset it here (this link expires in ${RESET_TOKEN_TTL_MINUTES} minutes and can only be used once):\n${resetUrl}\n\n` +
              `If you didn't request this, you can safely ignore this email — nothing changes until the link above is actually used.`,
      });
    } catch (emailErr) {
      console.error('Admin password reset email failed:', emailErr);
      return json({ error: 'Could not send the reset email — check that RESEND_API_KEY is configured.' }, 500);
    }

    return json({ message: 'A reset link has been sent to the configured recovery email.' });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
