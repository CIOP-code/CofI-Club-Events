/**
 * GET  /api/feedback   – list all feedback, newest first (admin only)
 * POST /api/feedback   – submit feedback/bug report (public, no auth)
 */
import { sendEmail } from '../utils/email.js';
import { checkRateLimit, recordAttempt } from '../utils/rateLimit.js';

const CATEGORIES = ['bug', 'suggestion', 'other'];
const MAX_MESSAGE_LENGTH = 4000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env, data }) {
  if (data?.user?.type !== 'admin') {
    return json({ error: 'Unauthorized – admin only' }, 401);
  }
  try {
    const result = await env.DB.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all();
    return json({ feedback: result.results });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export async function onRequestPost({ env, request }) {
  // No login is required to submit feedback, which is exactly why this endpoint -- unlike the
  // rest of the app's mutating routes -- needs its own abuse guard: nothing else stops a script
  // from flooding the feedback table and, worse, burning through the Resend send quota. Fails
  // open (lets the submission through) if the login_attempts table isn't migrated in yet, same
  // as the login endpoints.
  let ip = null;
  try {
    const rl = await checkRateLimit(env, request, 'feedback');
    ip = rl.ip;
    if (!rl.allowed) {
      return json({ error: 'Too many submissions from this network. Try again in a few minutes.' }, 429);
    }
  } catch { /* rate limiting unavailable; don't block submission on it */ }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const message = (body.message || '').trim();
  const category = body.category || 'suggestion';
  const contact_email = (body.contact_email || '').trim() || null;

  if (!message) return json({ error: 'message is required' }, 400);
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` }, 400);
  }
  if (!CATEGORIES.includes(category)) {
    return json({ error: `category must be one of: ${CATEGORIES.join(', ')}` }, 400);
  }

  try {
    if (ip) await recordAttempt(env, ip, 'feedback').catch(() => {});

    const result = await env.DB.prepare(
      `INSERT INTO feedback (category, message, contact_email) VALUES (?, ?, ?)`
    ).bind(category, message, contact_email).run();

    // Best-effort notification -- feedback is stored regardless of whether this succeeds, so a
    // missing RESEND_API_KEY, no notify_email configured yet, or a Resend outage never blocks
    // the person submitting it.
    try {
      const admin = await env.DB.prepare('SELECT notify_email FROM admin WHERE id = 1').first();
      if (admin?.notify_email) {
        await sendEmail(env, {
          to: admin.notify_email,
          subject: `[Campus Events] New ${category} report`,
          text: `${message}\n\n${contact_email ? `Reply to: ${contact_email}` : '(no contact email provided)'}\n\n— Submitted via the Campus Events feedback form`,
        });
      }
    } catch (emailErr) {
      console.error('Feedback email notification failed:', emailErr);
    }

    return json({ id: result.meta.last_row_id, message: 'Feedback submitted' }, 201);
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
