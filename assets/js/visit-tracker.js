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

  function recordVisit() {
    if (document.prerendering) return;
    configureOwner();
    try {
      window.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ path: window.location.pathname, is_owner: isOwner() }),
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true
      }).catch(function () { /* Recording must never interrupt the page. */ });
    } catch (_) { /* Older browsers can continue without analytics. */ }
  }

  if (document.prerendering) {
    document.addEventListener('prerenderingchange', recordVisit, { once: true });
  } else {
    recordVisit();
  }
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) recordVisit();
  });
  // Also handle the settings link when this page is already open in the same tab.
  window.addEventListener('hashchange', configureOwner);
})();
