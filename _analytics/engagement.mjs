const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function text(value, max = 128) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}
function id(value) {
  if (!UUID.test(value || '')) throw new Error('Invalid ID');
  return value.toLowerCase();
}
function integer(value, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error('Invalid number');
  return value;
}
function timestamp(value, now) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > now + 60000 || ms < now - 7 * 86400000) return new Date(now).toISOString();
  return new Date(ms).toISOString();
}
export function cleanUrl(value, origin, referrer = false) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value, origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return (url.origin + (referrer && url.origin !== origin ? '' : url.pathname)).slice(0, 512);
  } catch (_) { return null; }
}
export function userAgentDetails(raw, tabletHint) {
  const ua = (raw || '').slice(0, 512);
  let browser = 'Other', browserVersion = null, os = 'Other', osVersion = null;
  for (const [name, re] of [
    ['Edge', /(?:EdgA|EdgiOS|Edg)\/([\d.]+)/], ['Opera', /(?:OPR|Opera)\/([\d.]+)/],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/], ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/], ['Safari', /Version\/([\d.]+).*Safari/]
  ]) {
    const match = ua.match(re);
    if (match) { browser = name; browserVersion = match[1]; break; }
  }
  for (const [name, re] of [
    ['iOS', /(?:iPhone OS|CPU OS) ([\d_]+)/], ['Android', /Android ([\d.]+)/],
    ['Windows', /Windows NT ([\d.]+)/], ['Chrome OS', /CrOS [^ ]+ ([\d.]+)/],
    ['macOS', /Mac OS X ([\d_]+)/], ['Linux', /Linux/]
  ]) {
    const match = ua.match(re);
    if (match) { os = name; osVersion = match[1]?.replaceAll('_', '.') || null; break; }
  }
  let device = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'tablet'
    : /Mobile|iPhone|iPod/i.test(ua) ? 'mobile' : ua ? 'desktop' : 'unknown';
  if (tabletHint === true && os === 'macOS') { device = 'tablet'; os = 'iPadOS'; osVersion = null; }
  if (/bot|crawler|spider|headless/i.test(ua)) device = 'bot';
  return [browser, browserVersion, os, osVersion, device];
}

export function engagementStatements(request, env, payload, path, visitorType, now = Date.now()) {
  if (payload.v !== 2) throw new Error('Unsupported version');
  const pageId = id(payload.page_id);
  const visitorId = payload.visitor_id === null ? null : id(payload.visitor_id);
  const sessionId = id(payload.session_id);
  const sequence = integer(payload.page_sequence, 1000000);
  const active = integer(payload.active_ms, 7 * 86400000);
  const scroll = integer(payload.max_scroll_pct, 100);
  const started = timestamp(payload.started_at, now);
  const received = new Date(now).toISOString();
  const previous = typeof payload.previous_path === 'string' && payload.previous_path.startsWith('/') && !payload.previous_path.startsWith('//')
    ? cleanUrl(payload.previous_path, env.ALLOWED_ORIGIN)?.slice(env.ALLOWED_ORIGIN.length) || null : null;
  const utm = payload.utm || {};
  const languages = Array.isArray(payload.languages) ? JSON.stringify(payload.languages.slice(0, 5).map(x => text(x, 35)).filter(Boolean)) : null;
  const cf = request.cf;
  const values = [
    request.headers.get('CF-Connecting-IP'), received, path, text(cf.country, 2), text(cf.region), text(cf.city), text(cf.timezone), visitorType,
    pageId, visitorId, sessionId, sequence, started, received, previous,
    cleanUrl(payload.referrer, env.ALLOWED_ORIGIN, true),
    ...userAgentDetails(request.headers.get('User-Agent'), payload.tablet_hint),
    text(payload.language, 35), languages, text(payload.browser_timezone, 80),
    ...['source', 'medium', 'campaign', 'term', 'content'].map(key => text(utm[key], 128)),
    Number.isSafeInteger(cf.asn) && cf.asn > 0 ? cf.asn : null, text(cf.asOrganization, 200), active, scroll
  ];
  const columns = `ip, visited_at, path, country, region, city, timezone, visitor_type,
    page_id, visitor_id, session_id, page_sequence, started_at, last_seen_at, previous_path, referrer,
    browser, browser_version, os, os_version, device_type, language, languages, browser_timezone,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, asn, as_organization, active_ms, max_scroll_pct`;
  const statements = [env.DB.prepare(`INSERT INTO visits (${columns}) VALUES (${values.map(() => '?').join(',')})
    ON CONFLICT(page_id) DO UPDATE SET
      active_ms = MAX(visits.active_ms, excluded.active_ms),
      max_scroll_pct = MAX(visits.max_scroll_pct, excluded.max_scroll_pct),
      last_seen_at = MAX(visits.last_seen_at, excluded.last_seen_at)
    WHERE visits.visitor_id IS excluded.visitor_id AND visits.session_id = excluded.session_id AND visits.path = excluded.path
  `).bind(...values)];
  const clicks = payload.clicks === undefined ? [] : payload.clicks;
  if (!Array.isArray(clicks) || clicks.length > 5) throw new Error('Invalid clicks');
  for (const click of clicks) {
    const eventId = id(click.event_id);
    const target = ['mailto:', 'tel:'].includes(click.target_url) ? click.target_url : cleanUrl(click.target_url, env.ALLOWED_ORIGIN);
    if (!target) throw new Error('Invalid target');
    let kind = target === 'mailto:' ? 'email' : target === 'tel:' ? 'phone' : 'external';
    if (/\.pdf$/i.test(target)) kind = 'pdf';
    else if (target.startsWith('https://github.com/')) kind = 'github';
    else if (target.startsWith('https://scholar.google.')) kind = 'scholar';
    else if (target.startsWith(env.ALLOWED_ORIGIN + '/')) kind = 'internal';
    statements.push(env.DB.prepare(`INSERT INTO link_clicks
      (event_id, page_id, clicked_at, received_at, target_url, link_text, link_type, paper_title)
      SELECT ?, page_id, ?, ?, ?, ?, ?, ? FROM visits
      WHERE page_id = ? AND visitor_id IS ? AND session_id = ? AND path = ?
      ON CONFLICT(event_id) DO NOTHING
    `).bind(eventId, timestamp(click.clicked_at, now), received, target, text(click.link_text, 120), kind,
      text(click.paper_title, 240), pageId, visitorId, sessionId, path));
  }
  return statements;
}
