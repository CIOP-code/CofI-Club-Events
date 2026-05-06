// Former upload endpoint removed: file storage (R2) is no longer used.
export async function onRequestPost() {
  return new Response(JSON.stringify({ error: 'File upload endpoint removed; images are not supported' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  });
}
