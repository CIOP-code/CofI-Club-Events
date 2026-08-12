/**
 * GET /api/admin/settings   – get admin settings (currently just notify_email)
 * PUT /api/admin/settings   – update admin settings
 * Both admin only.
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestGet({ env, data }) {
  if (data?.user?.type !== 'admin') {
    return json({ error: 'Unauthorized – admin only' }, 401);
  }
  try {
    const admin = await env.DB.prepare('SELECT notify_email FROM admin WHERE id = 1').first();
    return json({ notify_email: admin?.notify_email || '' });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export async function onRequestPut({ env, request, data }) {
  if (data?.user?.type !== 'admin') {
    return json({ error: 'Unauthorized – admin only' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const notify_email = (body.notify_email || '').trim();
  if (notify_email && !EMAIL_RE.test(notify_email)) {
    return json({ error: 'notify_email must be a valid email address' }, 400);
  }

  try {
    await env.DB.prepare('UPDATE admin SET notify_email = ? WHERE id = 1')
      .bind(notify_email || null).run();
    return json({ message: 'Settings updated' });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
