/**
 * DELETE /api/feedback/:id   – dismiss a feedback item (admin only). Deleting IS the "handled"
 *                              action -- there's no separate status/archive field.
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete({ env, params, data }) {
  if (data?.user?.type !== 'admin') {
    return json({ error: 'Unauthorized – admin only' }, 401);
  }
  const { id } = params;
  try {
    await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
    return json({ message: 'Feedback deleted' });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
