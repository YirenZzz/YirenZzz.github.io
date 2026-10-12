(function () {
  'use strict';

  // Clear this URL to disable logging after republishing the site.
  // This URL is public. Never put a Cloudflare token or database credential here.
  var endpoint = 'https://yirenzzz-private-visits.yirenzzz-visits.workers.dev/collect';
  if (!endpoint || window.location.origin !== 'https://yirenzzz.github.io') return;
  if (window.__visitTrackerStarted) return;
  window.__visitTrackerStarted = true;

  // A browser preference for analytics classification, not an authentication token.
  var ownerKey = 'yirenzzz.analytics.owner';
  var temporaryOwner = false;
  var storageUnavailable = false;
  function isOwner() {
    if (storageUnavailable) return temporaryOwner;
    try {
      return window.localStorage.getItem(ownerKey) === '1';
    } catch (_) {
      return temporaryOwner;
    }
  }

  function configureOwner() {
    if (document.prerendering) return;
    var hash = window.location.hash;
    if (hash !== '#analytics-owner=on' && hash !== '#analytics-owner=off') return;
    temporaryOwner = hash === '#analytics-owner=on';
    var saved = true;
    try {
      if (temporaryOwner) window.localStorage.setItem(ownerKey, '1');
      else window.localStorage.removeItem(ownerKey);
      storageUnavailable = false;
    } catch (_) {
      saved = false;
      storageUnavailable = true;
    }
    // Remove the setting from the address bar to avoid sharing it accidentally.
    try {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    } catch (_) { /* The browser preference still applies if URL cleanup fails. */ }
    window.alert(saved
      ? (temporaryOwner ? '已将此浏览器标记为自己的访问。以后使用此浏览器访问会单独统计。' : '已取消此浏览器的自己的访问标记。')
      : '浏览器禁止保存标记，本次设置仅对当前页面有效。请允许此网站存储数据后重试。');
  }

  var sessionKey = 'yirenzzz.analytics.session';
  var visitorKey = 'yirenzzz.analytics.visitor';
  var timeout = 30 * 60 * 1000;
  var session = null;
  var page = null;
  var visitorId = null;
  var initialized = false;
  var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function uuid() {
    if (window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  function visible() { return document.visibilityState !== 'hidden'; }
  function tick() { return window.performance.now(); }
  function saveSession() {
    try { window.sessionStorage.setItem(sessionKey, JSON.stringify(session)); } catch (_) {}
  }
  function touch() {
    session.lastActive = Date.now();
    saveSession();
  }
  function safeUrl(value, referrer) {
    try {
      var url = new URL(value, window.location.origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return (url.origin + (referrer && url.origin !== window.location.origin ? '' : url.pathname)).slice(0, 512);
    } catch (_) { return null; }
  }
  function campaign() {
    var params = new URLSearchParams(window.location.search);
    var result = {};
    ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (key) {
      var value = params.get('utm_' + key);
      if (value) result[key] = value.slice(0, 128);
    });
    return result;
  }
  function sampleScroll() {
    if (!page || !visible()) return;
    var root = document.documentElement;
    var height = Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0);
    var viewport = window.innerHeight || root.clientHeight;
    var range = height - viewport;
    var percent = range > 0 ? Math.round(100 * (window.scrollY || root.scrollTop || 0) / range)
      : document.readyState === 'complete' ? 100 : 0;
    page.maxScroll = Math.max(page.maxScroll, Math.min(100, Math.max(0, percent)));
  }
  function accrue() {
    if (!page || page.since === null) return;
    var now = tick();
    // Bound a single gap so a sleeping computer does not add hours of apparent reading.
    page.active += Math.min(60000, Math.max(0, now - page.since));
    page.since = visible() ? now : null;
    touch();
  }
  function flush() {
    if (!page) return;
    accrue();
    sampleScroll();
    var current = page;
    var clicks = current.pending.slice(0, 5);
    var payload = Object.assign({}, current.metadata, {
      active_ms: Math.round(current.active), max_scroll_pct: current.maxScroll, clicks: clicks
    });
    try {
      window.fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload), mode: 'cors', credentials: 'omit',
        referrerPolicy: 'no-referrer', keepalive: true
      }).then(function (response) {
        if (!response || response.status !== 204) return;
        var sent = new Set(clicks.map(function (click) { return click.event_id; }));
        current.pending = current.pending.filter(function (click) { return !sent.has(click.event_id); });
      }).catch(function () {});
    } catch (_) { /* Analytics must never interrupt navigation. */ }
  }
  function restoreSession() {
    try {
      var saved = JSON.parse(window.sessionStorage.getItem(sessionKey));
      if (saved && uuidPattern.test(saved.id) && Number.isFinite(saved.lastActive) &&
          Number.isInteger(saved.sequence) && saved.sequence >= 0 && saved.sequence < 1000000 &&
          typeof saved.lastPath === 'string') session = saved;
    } catch (_) {}
  }
  function startPage(forceSession) {
    configureOwner();
    if (forceSession) session = null;
    else restoreSession();
    var now = Date.now();
    if (!session || now - session.lastActive >= timeout || now < session.lastActive) {
      session = { id: uuid(), sequence: 0, lastActive: now, lastPath: null };
    }
    var previous = session.lastPath;
    session.sequence += 1;
    session.lastPath = window.location.pathname;
    session.lastActive = now;
    saveSession();
    var timezone = null;
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) {}
    page = {
      active: 0, maxScroll: 0, since: visible() ? tick() : null, pending: [],
      metadata: {
        v: 2, path: window.location.pathname, is_owner: isOwner(),
        page_id: uuid(), visitor_id: visitorId, session_id: session.id, page_sequence: session.sequence,
        started_at: new Date(now).toISOString(), previous_path: previous,
        referrer: document.referrer ? safeUrl(document.referrer, true) : null,
        language: navigator.language || null, languages: (navigator.languages || []).slice(0, 5),
        browser_timezone: timezone, utm: campaign(),
        tablet_hint: navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
      }
    };
    flush();
  }
  function resume() {
    if (!page) return;
    if (Date.now() - session.lastActive >= timeout) {
      flush();
      startPage(true);
    } else {
      page.since = tick();
      touch();
    }
  }
  function trackClick(event) {
    if (!page || (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0)) return;
    try {
      var element = event.target.nodeType === 1 ? event.target : event.target.parentElement;
      var link = element && element.closest('a[href]');
      if (!link) return;
      var raw = link.getAttribute('href');
      if (!raw) return;
      var target = /^mailto:/i.test(raw) ? 'mailto:' : /^tel:/i.test(raw) ? 'tel:' : safeUrl(raw, false);
      if (!target) return;
      if (Date.now() - session.lastActive >= timeout) { flush(); startPage(true); }
      var card = link.closest('.publication-item');
      var title = card && card.querySelector('.publication-title, h3');
      var clean = function (text, limit) { return text ? text.replace(/\s+/g, ' ').trim().slice(0, limit) : null; };
      page.pending.push({
        event_id: uuid(), clicked_at: new Date().toISOString(), target_url: target,
        link_text: clean(link.getAttribute('aria-label') || link.getAttribute('title') || link.textContent, 120),
        paper_title: title ? clean(title.textContent, 240) : null
      });
      if (page.pending.length > 50) page.pending.shift();
      touch();
      flush();
    } catch (_) {}
  }
  function initialize() {
    if (initialized || document.prerendering) return;
    initialized = true;
    try {
      try {
        visitorId = window.localStorage.getItem(visitorKey);
        if (!uuidPattern.test(visitorId || '')) {
          visitorId = uuid();
          window.localStorage.setItem(visitorKey, visitorId);
        }
      } catch (_) { visitorId = null; }
      startPage();
      window.setInterval(function () {
        if (!visible()) return;
        if (Date.now() - session.lastActive >= timeout) { flush(); startPage(true); }
        else flush();
      }, 30000);
      document.addEventListener('visibilitychange', function () {
        if (!visible()) { flush(); page.since = null; }
        else resume();
      });
      window.addEventListener('pagehide', function () { flush(); page.since = null; });
      window.addEventListener('pageshow', function (event) { if (event.persisted) startPage(); });
      window.addEventListener('scroll', sampleScroll, { passive: true });
      window.addEventListener('resize', sampleScroll, { passive: true });
      window.addEventListener('load', sampleScroll);
      document.addEventListener('click', trackClick, true);
      document.addEventListener('auxclick', trackClick, true);
    } catch (_) {
      // Keep basic collection on older browsers that cannot generate secure IDs.
      try {
        window.fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ path: window.location.pathname, is_owner: isOwner() }),
          credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true
        }).catch(function () {});
      } catch (_) {}
    }
  }
  if (document.prerendering) document.addEventListener('prerenderingchange', initialize, { once: true });
  else initialize();
  window.addEventListener('hashchange', configureOwner);
})();
