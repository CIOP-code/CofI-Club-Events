// File serve endpoint removed: file storage (R2) is no longer used.
export async function onRequestGet() {
  return new Response('File endpoints removed; images are not supported', { status: 410 });
}
