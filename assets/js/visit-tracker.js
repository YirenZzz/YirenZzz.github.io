(function () {
  'use strict';

  // Clear this URL to disable logging after republishing the site.
  // This URL is public. Never put a Cloudflare token or database credential here.
  var endpoint = 'https://yirenzzz-private-visits.yirenzzz-visits.workers.dev/collect';
  if (!endpoint || window.location.origin !== 'https://yirenzzz.github.io') return;
  if (window.__visitTrackerStarted) return;
  window.__visitTrackerStarted = true;

  function recordVisit() {
    if (document.prerendering) return;
    try {
      window.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ path: window.location.pathname }),
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
})();
