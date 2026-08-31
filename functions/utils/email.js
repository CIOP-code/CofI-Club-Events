/**
 * Minimal wrapper around Resend's REST API (resend.com) -- a plain fetch() call, not their SDK,
 * matching this app's no-server-side-npm-dependencies rule (see SECURITY.md).
 *
 * Requires the RESEND_API_KEY secret. Deliberately does NOT use requireEnv() here: unlike
 * JWT_SECRET/ADMIN_PASSWORD, a missing key shouldn't fail the request that triggered the email
 * (e.g. someone submitting feedback) -- callers should treat a missing key or a failed send as
 * non-fatal and log it, not surface it to whoever's action triggered the email.
 */
const FROM_ADDRESS = 'Campus Events <onboarding@resend.dev>';

export async function sendEmail(env, { to, subject, text }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}
