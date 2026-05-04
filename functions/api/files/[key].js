/**
 * GET /api/files/:key  – serve a file stored in R2
 */
export async function onRequestGet({ env, params }) {
  const key = params.key;
  if (!key) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const object = await env.BUCKET.get(key);
    if (!object) return new Response('File not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000');

    return new Response(object.body, { headers });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}
