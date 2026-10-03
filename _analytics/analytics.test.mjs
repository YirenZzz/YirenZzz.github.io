import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from './worker.mjs';

const origin = 'https://yirenzzz.github.io';
function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./migrations/0001_visits.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('./migrations/0002_owner_visits.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  return { db, env: {
    ALLOWED_ORIGIN: origin,
    DB: { prepare: (sql) => ({ bind: (...args) => ({ run: async () => db.prepare(sql).run(...args) }) }) }
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
  owner = false, hash = '#private', storageFails = false } = {}) {
  const calls = [];
  const events = {};
  const alerts = [];
  const storage = new Map(owner ? [['yirenzzz.analytics.owner', '1']] : []);
  const context = {
    window: {
      location: { origin: site, pathname: '/publications/', search: '?secret=test', hash },
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
      fetch: (...args) => { calls.push(args); return fail ? Promise.reject(new Error('offline')) : Promise.resolve(); },
      addEventListener: (name, callback) => { events[name] = callback; }
    },
    document: {
      prerendering,
      addEventListener: (name, callback) => { events[name] = callback; }
    }
  };
  vm.createContext(context);
  const script = tracker.replace(/var endpoint = '[^']*';/,
    enabled ? "var endpoint = 'https://collector.example/collect';" : "var endpoint = '';"
  );
  return { context, calls, events, storage, alerts, run: () => vm.runInContext(script, context) };
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
  assert.deepEqual(JSON.parse(options.body), { path: '/publications/', is_owner: false });
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
  assert.equal(browser.storage.size, 0);
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
  assert.equal(browser.storage.size, 0);
  assert.equal(browser.alerts.length, 0);
  browser.context.document.prerendering = false;
  browser.events.prerenderingchange();
  assert.equal(JSON.parse(browser.calls[0][1].body).is_owner, true);
  const ordinary = browserContext();
  ordinary.run();
  assert.equal(ordinary.context.window.location.hash, '#private');
});
