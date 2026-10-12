import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import worker from './worker.mjs';

const origin = 'https://yirenzzz.github.io';
function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./migrations/0001_visits.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('./migrations/0002_owner_visits.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('./migrations/0003_engagement.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  t.after(() => db.close());
  return { db, env: {
    ALLOWED_ORIGIN: origin,
    DB: {
      prepare: (sql) => ({ bind: (...args) => ({ run: async () => db.prepare(sql).run(...args) }) }),
      batch: async (statements) => {
        db.exec('BEGIN');
        try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      }
    }
  } };
}
function request({ method = 'POST', url = '/collect', body = { path: '/' }, headers = {}, cf = {} } = {}) {
  const req = new Request('https://collector.example' + url, {
    method,
    headers: { Origin: origin, 'Content-Type': 'text/plain', 'CF-Connecting-IP': '192.0.2.1', ...headers },
    ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
  });
  Object.defineProperty(req, 'cf', { value: cf });
  return req;
}

test('stores edge IP, geography, UTC time and paths; counts repeat visits', async (t) => {
  const { db, env } = setup(t);
  const before = new Date().toISOString();
  for (const path of ['/', '/publications/?secret=test#private']) {
    const res = await worker.fetch(request({
      body: { path, ip: '198.51.100.99', visited_at: 'fake', city: 'fake' },
      headers: { 'X-Forwarded-For': '198.51.100.99' },
      cf: { country: 'CA', region: 'Ontario', city: 'Toronto', timezone: 'America/Toronto' }
    }), env);
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
  const rows = db.prepare('SELECT * FROM visits ORDER BY id').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ip, '192.0.2.1');
  assert.equal(rows[0].city, 'Toronto');
  assert.equal(rows[0].country, 'CA');
  assert.ok(rows[0].visited_at >= before && rows[0].visited_at <= new Date().toISOString());
  assert.equal(rows[1].path, '/publications/');
  assert.equal(db.prepare('SELECT visit_count FROM visitor_totals').get().visit_count, 2);
});

test('supports IPv6 and unknown geography without inventing a location', async (t) => {
  const { db, env } = setup(t);
  assert.equal((await worker.fetch(request({ headers: { 'CF-Connecting-IP': '2001:db8::1' } }), env)).status, 204);
  const row = db.prepare('SELECT * FROM visits').get();
  assert.equal(row.ip, '2001:db8::1');
  assert.equal(row.city, null);
  assert.equal(row.country, null);
});

test('rejects untrusted, malformed and oversized writes without recording them', async (t) => {
  const { db, env } = setup(t);
  for (const [options, status] of [
    [{ headers: { Origin: 'https://other.example' } }, 403],
    [{ headers: { Origin: '' } }, 403],
    [{ headers: { 'CF-Connecting-IP': '' } }, 400],
    [{ cf: null }, 400],
    [{ headers: { 'Content-Type': 'text/html' } }, 415],
    [{ body: 'invalid JSON' }, 400],
    [{ body: 'x'.repeat(2049) }, 400],
    [{ body: { path: '//other.example/' } }, 400],
    [{ body: { path: 'https://other.example/' } }, 400],
    [{ body: { path: '/\\other.example' } }, 400],
    [{ body: { path: '/bad\npath' } }, 400],
    [{ body: { path: '/' + 'x'.repeat(1024) } }, 400],
    [{ body: null }, 400]
  ]) {
    assert.equal((await worker.fetch(request(options), env)).status, status, JSON.stringify(options));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM visits').get().count, 0);
});

test('exposes no read API and preflight never creates records', async (t) => {
  const { db, env } = setup(t);
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
    const res = await worker.fetch(request({ method }), env);
    assert.equal(res.status, 405);
    assert.equal(await res.text(), '');
  }
  for (const url of ['/visits', '/stats', '/', '/collect/']) {
    assert.equal((await worker.fetch(request({ url, method: 'GET' }), env)).status, 404);
  }
  assert.equal((await worker.fetch(request({ method: 'OPTIONS' }), env)).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM visits').get().count, 0);
});

test('database failure returns generic failure, never success or sensitive details', async () => {
  const res = await worker.fetch(request(), {
    ALLOWED_ORIGIN: origin,
    DB: { prepare() { throw new Error('private database detail'); } }
  });
  assert.equal(res.status, 503);
  assert.equal(await res.text(), '');
});

const tracker = readFileSync(new URL('../assets/js/visit-tracker.js', import.meta.url), 'utf8');
function browserContext({ enabled = true, site = origin, prerendering = false, fail = false,
  owner = false, hash = '#private', storageFails = false, local = null, tab = new Map(), now = Date.now() } = {}) {
  const calls = [];
  const events = {};
  const alerts = [];
  const storage = local || new Map(owner ? [['yirenzzz.analytics.owner', '1']] : []);
  let clock = now;
  const timers = [];
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const context = {
    URL, URLSearchParams, Date: FakeDate,
    navigator: { language: 'en-CA', languages: ['en-CA', 'zh-CN'], platform: 'MacIntel', maxTouchPoints: 0 },
    window: {
      location: { origin: site, pathname: '/publications/', search: '?secret=test', hash },
      crypto: webcrypto,
      performance: { now: () => clock },
      setInterval: (callback) => timers.push(callback),
      innerHeight: 500, scrollY: 0,
      sessionStorage: {
        getItem(key) { if (storageFails) throw new Error('blocked'); return tab.get(key) ?? null; },
        setItem(key, value) { if (storageFails) throw new Error('blocked'); tab.set(key, value); }
      },
      localStorage: {
        getItem(key) { if (storageFails) throw new Error('blocked'); return storage.get(key) ?? null; },
        setItem(key, value) { if (storageFails) throw new Error('blocked'); storage.set(key, value); },
        removeItem(key) { if (storageFails) throw new Error('blocked'); storage.delete(key); }
      },
      history: { state: { existing: true }, replaceState(state, title, url) {
        assert.equal(state.existing, true);
        assert.equal(url, '/publications/?secret=test');
        context.window.location.hash = '';
      } },
      alert: (message) => alerts.push(message),
      fetch: (...args) => { calls.push(args); return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ status: 204 }); },
      addEventListener: (name, callback) => { events[name] = callback; }
    },
    document: {
      prerendering, visibilityState: 'visible', readyState: 'complete',
      referrer: 'https://search.example/results?secret=hidden#fragment',
      documentElement: { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 },
      body: { scrollHeight: 2000 },
      addEventListener: (name, callback) => { events[name] = callback; }
    }
  };
  vm.createContext(context);
  const script = tracker.replace(/var endpoint = '[^']*';/,
    enabled ? "var endpoint = 'https://collector.example/collect';" : "var endpoint = '';"
  );
  return { context, calls, events, storage, tab, alerts, timers, advance: (ms) => { clock += ms; }, time: () => clock, run: () => vm.runInContext(script, context) };
}

test('browser remains inactive until configured and excludes local preview', () => {
  for (const options of [{ enabled: false }, { site: 'http://localhost:8000' }]) {
    const browser = browserContext(options);
    browser.run();
    assert.equal(browser.calls.length, 0);
  }
});

test('browser sends path and classification, omits credentials, and avoids duplicate initialization', async () => {
  const browser = browserContext({ fail: true });
  browser.run();
  browser.run();
  browser.events.pageshow({ persisted: false });
  assert.equal(browser.calls.length, 1);
  const [, options] = browser.calls[0];
  assert.equal(JSON.parse(options.body).path, '/publications/');
  assert.equal(JSON.parse(options.body).is_owner, false);
  assert.equal(JSON.parse(options.body).referrer, 'https://search.example');
  assert.ok(!options.body.includes('secret=test'));
  assert.equal(browser.alerts.length, 0);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  browser.events.pageshow({ persisted: true });
  assert.equal(browser.calls.length, 2);
  await Promise.resolve();
});

test('prerendered page only records after activation', () => {
  const browser = browserContext({ prerendering: true });
  browser.run();
  assert.equal(browser.calls.length, 0);
  browser.context.document.prerendering = false;
  browser.events.prerenderingchange();
  assert.equal(browser.calls.length, 1);
});

test('same IP can have owner, visitor and unknown records with separate totals', async (t) => {
  const { db, env } = setup(t);
  for (const marker of [true, true, false, undefined, 'true']) {
    assert.equal((await worker.fetch(request({ body: { path: '/', is_owner: marker } }), env)).status, 204);
  }
  const totals = db.prepare('SELECT visitor_type, visit_count FROM visitor_totals_by_type ORDER BY visitor_type').all();
  assert.deepEqual(totals.map(row => [row.visitor_type, row.visit_count]), [['owner', 2], ['unknown', 2], ['visitor', 1]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM owner_visits').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM other_visits').get().n, 1);
  assert.equal(db.prepare('SELECT visit_count FROM visitor_totals').get().visit_count, 5);
});

test('migration preserves historical data and marks it unknown', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(new URL('./migrations/0001_visits.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO visits (ip, visited_at, path) VALUES ('192.0.2.1', '2026-10-03T12:00:00.000Z', '/')");
  db.exec(readFileSync(new URL('./migrations/0002_owner_visits.sql', import.meta.url), 'utf8'));
  const row = db.prepare('SELECT * FROM visits').get();
  assert.equal(row.visitor_type, 'unknown');
  assert.equal(row.visited_at, '2026-10-03T12:00:00.000Z');
  assert.equal(db.prepare('SELECT visit_count FROM visitor_totals').get().visit_count, 1);
});

test('owner setting persists, is removed from URL, and can be disabled', () => {
  const browser = browserContext({ hash: '#analytics-owner=on' });
  browser.run();
  assert.equal(JSON.parse(browser.calls[0][1].body).is_owner, true);
  assert.equal(browser.storage.get('yirenzzz.analytics.owner'), '1');
  assert.equal(browser.context.window.location.hash, '');
  assert.equal(browser.alerts.length, 1);
  browser.context.window.location.hash = '#analytics-owner=off';
  browser.events.hashchange();
  assert.equal(browser.storage.has('yirenzzz.analytics.owner'), false);
  browser.events.pageshow({ persisted: true });
  assert.equal(JSON.parse(browser.calls[1][1].body).is_owner, false);
  const returning = browserContext({ owner: true });
  returning.run();
  assert.equal(JSON.parse(returning.calls[0][1].body).is_owner, true);
  assert.equal(returning.alerts.length, 0);
});

test('storage failure does not interrupt collection and temporary setting is explicit', () => {
  for (const hash of ['#private', '#analytics-owner=on', '#analytics-owner=off']) {
    const browser = browserContext({ hash, storageFails: true });
    browser.run();
    assert.equal(JSON.parse(browser.calls[0][1].body).is_owner, hash === '#analytics-owner=on');
    if (hash !== '#private') assert.match(browser.alerts[0], /仅对当前页面有效/);
  }
});

test('prerender activation delays owner settings and unrecognized fragments are untouched', () => {
  const browser = browserContext({ prerendering: true, hash: '#analytics-owner=on' });
  browser.run();
  assert.equal(browser.storage.has('yirenzzz.analytics.owner'), false);
  assert.equal(browser.alerts.length, 0);
  browser.context.document.prerendering = false;
  browser.events.prerenderingchange();
  assert.equal(JSON.parse(browser.calls[0][1].body).is_owner, true);
  const ordinary = browserContext();
  ordinary.run();
  assert.equal(ordinary.context.window.location.hash, '#private');
});

function enhanced(overrides = {}) {
  return {
    v: 2, path: '/', is_owner: false,
    page_id: webcrypto.randomUUID(), visitor_id: webcrypto.randomUUID(), session_id: webcrypto.randomUUID(),
    page_sequence: 1, started_at: new Date().toISOString(), active_ms: 0, max_scroll_pct: 0,
    language: 'en-CA', languages: ['en-CA', 'zh-CN'], browser_timezone: 'America/Toronto',
    referrer: 'https://search.example/private?q=secret#hidden', previous_path: '/publications/?token=hidden',
    utm: { source: 'newsletter', campaign: 'autumn', password: 'do-not-store' }, clicks: [], ...overrides
  };
}

test('new visits capture requested metadata and ignore spoofed network data', async (t) => {
  const { db, env } = setup(t);
  const body = enhanced({ asn: 123, as_organization: 'spoofed', path: '/?token=secret' });
  const res = await worker.fetch(request({ body,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0' },
    cf: { asn: 64500, asOrganization: 'Example Network', country: 'CA', city: 'Toronto' }
  }), env);
  assert.equal(res.status, 204);
  const row = db.prepare('SELECT * FROM visits').get();
  assert.equal(row.browser, 'Edge');
  assert.equal(row.os, 'Windows');
  assert.equal(row.device_type, 'desktop');
  assert.equal(row.asn, 64500);
  assert.equal(row.as_organization, 'Example Network');
  assert.equal(row.language, 'en-CA');
  assert.deepEqual(JSON.parse(row.languages), ['en-CA', 'zh-CN']);
  assert.equal(row.browser_timezone, 'America/Toronto');
  assert.equal(row.referrer, 'https://search.example');
  assert.equal(row.previous_path, '/publications/');
  assert.equal(row.utm_source, 'newsletter');
  assert.equal(row.utm_campaign, 'autumn');
  assert.ok(!JSON.stringify(row).includes('secret'));
  assert.ok(!JSON.stringify(row).includes('do-not-store'));
});

test('heartbeat replays and out-of-order delivery never inflate views, duration or clicks', async (t) => {
  const { db, env } = setup(t);
  const body = enhanced({ active_ms: 30000, max_scroll_pct: 80, clicks: [{
    event_id: webcrypto.randomUUID(), clicked_at: new Date().toISOString(),
    target_url: 'https://example.org/paper.pdf?signature=secret#page=2', link_text: 'Paper', paper_title: 'Example Research'
  }] });
  // Simulates a progress/click packet arriving before the initial page-load packet.
  for (const payload of [body, body, { ...body, active_ms: 0, max_scroll_pct: 0, clicks: [] }]) {
    assert.equal((await worker.fetch(request({ body: payload }), env)).status, 204);
  }
  const row = db.prepare('SELECT * FROM visits').get();
  assert.equal(row.active_ms, 30000);
  assert.equal(row.max_scroll_pct, 80);
  assert.equal(db.prepare('SELECT visit_count FROM visitor_totals').get().visit_count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM link_clicks').get().n, 1);
  assert.equal(db.prepare('SELECT target_url FROM link_clicks').get().target_url, 'https://example.org/paper.pdf');
  const interest = db.prepare('SELECT * FROM paper_interest').get();
  assert.equal(interest.link_clicks, 1);
  assert.equal(interest.pdf_clicks, 1);
  assert.equal(interest.known_browsers, 1);
});

test('session views expose ordered paths, first sessions and returning sessions', async (t) => {
  const { db, env } = setup(t);
  const first = enhanced({ started_at: new Date(Date.now() - 5000).toISOString(), active_ms: 500 });
  const next = { ...first, page_id: webcrypto.randomUUID(), page_sequence: 2, path: '/publications/', previous_path: '/', active_ms: 800 };
  const returning = { ...first, page_id: webcrypto.randomUUID(), session_id: webcrypto.randomUUID(), started_at: new Date().toISOString(), active_ms: 100 };
  for (const body of [next, first, returning]) assert.equal((await worker.fetch(request({ body }), env)).status, 204);
  const sessions = db.prepare('SELECT * FROM session_summary ORDER BY started_at').all();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].page_views, 2);
  assert.equal(sessions[0].is_returning, 0);
  assert.equal(sessions[0].active_ms, 1300);
  assert.equal(sessions[1].is_returning, 1);
  assert.deepEqual(db.prepare('SELECT path FROM session_paths WHERE session_id = ? ORDER BY step').all(first.session_id).map(x => x.path), ['/', '/publications/']);
  const profile = db.prepare('SELECT * FROM visitor_profiles').get();
  assert.equal(profile.session_count, 2);
  assert.equal(profile.page_views, 3);
});

test('legacy rows stay valid and unavailable historical metrics stay null', async (t) => {
  const { db, env } = setup(t);
  assert.equal((await worker.fetch(request(), env)).status, 204);
  const row = db.prepare('SELECT * FROM visits').get();
  assert.equal(row.active_ms, null);
  assert.equal(row.visitor_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_summary').get().n, 0);
});

test('invalid analytics packets never partially insert data', async (t) => {
  const { db, env } = setup(t);
  for (const change of [
    { v: 3 }, { visitor_id: 'not-an-id' }, { page_id: "'; DROP TABLE visits;" },
    { active_ms: -1 }, { max_scroll_pct: 101 }, { page_sequence: 1.5 },
    { clicks: Array(6).fill({}) }, { clicks: [{ event_id: webcrypto.randomUUID(), target_url: 'javascript:alert(1)' }] },
    { clicks: null }, { oversized: 'x'.repeat(17000) }
  ]) assert.equal((await worker.fetch(request({ body: enhanced(change) }), env)).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM visits').get().n, 0);
});

test('another session cannot rewrite metrics or attach clicks to an existing page', async (t) => {
  const { db, env } = setup(t);
  const original = enhanced();
  await worker.fetch(request({ body: original }), env);
  const attacker = enhanced({ page_id: original.page_id, active_ms: 9999, clicks: [{
    event_id: webcrypto.randomUUID(), target_url: 'https://example.org/', clicked_at: new Date().toISOString()
  }] });
  await worker.fetch(request({ body: attacker }), env);
  assert.equal(db.prepare('SELECT active_ms FROM visits').get().active_ms, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM link_clicks').get().n, 0);
});

test('foreground time excludes hidden tabs and scroll records the furthest position', () => {
  const browser = browserContext(); browser.run();
  browser.advance(10000);
  browser.context.window.scrollY = 750;
  browser.events.scroll();
  browser.context.document.visibilityState = 'hidden'; browser.events.visibilitychange();
  const hidden = JSON.parse(browser.calls.at(-1)[1].body);
  assert.equal(hidden.active_ms, 10000);
  assert.equal(hidden.max_scroll_pct, 50);
  const count = browser.calls.length;
  browser.advance(60000); browser.timers[0]();
  assert.equal(browser.calls.length, count);
  browser.context.document.visibilityState = 'visible'; browser.events.visibilitychange();
  browser.context.window.scrollY = 0; browser.events.scroll();
  browser.advance(5000); browser.timers[0]();
  const resumed = JSON.parse(browser.calls.at(-1)[1].body);
  assert.equal(resumed.active_ms, 15000);
  assert.equal(resumed.max_scroll_pct, 50);
  assert.equal(resumed.page_id, hidden.page_id);
});

test('navigation, bfcache and idle timeout keep browser identity but order and split sessions correctly', () => {
  const first = browserContext(); first.run();
  const a = JSON.parse(first.calls[0][1].body);
  first.advance(1000); first.events.pagehide();
  const next = browserContext({ local: first.storage, tab: first.tab, now: first.time() + 1000 });
  next.context.window.location.pathname = '/teaching/'; next.run();
  const b = JSON.parse(next.calls[0][1].body);
  assert.equal(b.visitor_id, a.visitor_id);
  assert.equal(b.session_id, a.session_id);
  assert.equal(b.page_sequence, 2);
  assert.equal(b.previous_path, '/publications/');
  first.advance(2000); first.events.pageshow({ persisted: true });
  const restored = JSON.parse(first.calls.at(-1)[1].body);
  assert.equal(restored.page_sequence, 3);
  assert.equal(restored.previous_path, '/teaching/');
  assert.notEqual(restored.page_id, a.page_id);
  first.context.document.visibilityState = 'hidden'; first.events.visibilitychange();
  first.advance(31 * 60000);
  first.context.document.visibilityState = 'visible'; first.events.visibilitychange();
  const later = JSON.parse(first.calls.at(-1)[1].body);
  assert.notEqual(later.session_id, a.session_id);
  assert.equal(later.visitor_id, a.visitor_id);
  assert.equal(later.page_sequence, 1);
});

test('blocked storage marks visitor identity unknown, rather than fabricating returning visitors', () => {
  const browser = browserContext({ storageFails: true }); browser.run();
  const body = JSON.parse(browser.calls[0][1].body);
  assert.equal(body.v, 2);
  assert.equal(body.visitor_id, null);
});

test('click tracking captures paper context and UTM allowlist without delaying navigation', async (t) => {
  const { db, env } = setup(t);
  const browser = browserContext();
  browser.context.window.location.search = '?utm_source=cv&utm_medium=email&utm_campaign=applications&token=private';
  browser.run();
  const anchor = {
    nodeType: 1, textContent: 'Paper',
    getAttribute: (name) => name === 'href' ? 'https://example.org/research.pdf?token=private' : null,
    closest: (selector) => selector === 'a[href]' ? anchor : { querySelector: () => ({ textContent: 'Research Paper' }) }
  };
  browser.events.click({ type: 'click', button: 0, target: anchor });
  const payload = JSON.parse(browser.calls.at(-1)[1].body);
  assert.equal(payload.clicks.length, 1);
  assert.equal(payload.clicks[0].target_url, 'https://example.org/research.pdf');
  assert.equal(payload.clicks[0].paper_title, 'Research Paper');
  assert.deepEqual(payload.utm, { source: 'cv', medium: 'email', campaign: 'applications' });
  assert.ok(!JSON.stringify(payload).includes('private'));
  // Exercise the real browser payload against the real collector SQL.
  assert.equal((await worker.fetch(request({ body: payload }), env)).status, 204);
  assert.equal(db.prepare('SELECT link_clicks FROM paper_interest').get().link_clicks, 1);
  await Promise.resolve(); await Promise.resolve();
  browser.timers[0]();
  assert.equal(JSON.parse(browser.calls.at(-1)[1].body).clicks.length, 0);
});
