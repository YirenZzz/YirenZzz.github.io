const MAX_BODY_BYTES = 2048;

async function readPayload(request) {
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function field(value, max = 128) {
  return typeof value === 'string' && value ? value.slice(0, max) : null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    const reply = (status) => new Response(null, { status, headers });
    if (new URL(request.url).pathname !== '/collect') return reply(404);
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return reply(403);
    headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') {
      headers['Access-Control-Allow-Methods'] = 'POST';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
      return reply(204);
    }
    // There is intentionally no HTTP endpoint for reading visitor records.
    if (request.method !== 'POST') return reply(405);
    const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim();
    if (!['text/plain', 'application/json'].includes(contentType)) return reply(415);

    let path;
    let visitorType;
    try {
      const payload = await readPayload(request);
      path = payload?.path;
      // Missing markers from older cached scripts stay unclassified.
      visitorType = payload?.is_owner === true ? 'owner'
        : payload?.is_owner === false ? 'visitor' : 'unknown';
      if (typeof path !== 'string' || path.length > 1024 ||
          !path.startsWith('/') || path.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(path)) {
        return reply(400);
      }
      // Never retain query strings or fragments, even from a modified client.
      path = new URL(path, env.ALLOWED_ORIGIN).pathname;
    } catch (_) {
      return reply(400);
    }

    // Trust only Cloudflare's incoming connection metadata, never JSON or X-Forwarded-For.
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip || ip.length > 45 || !request.cf) return reply(400);
    const cf = request.cf;
    try {
      await env.DB.prepare(`
        INSERT INTO visits (ip, visited_at, path, country, region, city, timezone, visitor_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        ip, new Date().toISOString(), path,
        field(cf.country, 2), field(cf.region), field(cf.city), field(cf.timezone), visitorType
      ).run();
    } catch (_) {
      // No database errors or visitor data in public responses or application logs.
      return reply(503);
    }
    return reply(204);
  }
};
