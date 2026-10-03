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
function browserContext({ enabled = true, site = origin, prerendering = false, fail = false } = {}) {
  const calls = [];
  const events = {};
  const context = {
    window: {
      location: { origin: site, pathname: '/publications/', search: '?secret=test', hash: '#private' },
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
  return { context, calls, events, run: () => vm.runInContext(script, context) };
}

test('browser remains inactive until configured and excludes local preview', () => {
  for (const options of [{ enabled: false }, { site: 'http://localhost:8000' }]) {
    const browser = browserContext(options);
    browser.run();
    assert.equal(browser.calls.length, 0);
  }
});

test('browser sends only path, omits credentials, and avoids duplicate initialization', async () => {
  const browser = browserContext({ fail: true });
  browser.run();
  browser.run();
  browser.events.pageshow({ persisted: false });
  assert.equal(browser.calls.length, 1);
  const [, options] = browser.calls[0];
  assert.deepEqual(JSON.parse(options.body), { path: '/publications/' });
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
