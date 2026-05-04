/**
 * POST /api/upload  – upload a file to R2
 * Expects multipart/form-data with a single field named "file".
 * Returns: { key, url }
 * Requires club or admin auth.
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function randomKey(prefix = 'file') {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${hex}`;
}

export async function onRequestPost({ env, request, data }) {
  const user = data?.user;
  if (!user || (user.type !== 'club' && user.type !== 'admin')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'Expected multipart/form-data' }, 400);
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return json({ error: 'No file provided' }, 400);
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return json({ error: 'Only JPEG, PNG, GIF, and WebP images are allowed' }, 400);
  }

  const prefix = user.type === 'admin' ? 'logo' : 'poster';
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
  const key = `${randomKey(prefix)}.${ext}`;

  try {
    await env.BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    return json({ key, url: `/api/files/${key}` });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
