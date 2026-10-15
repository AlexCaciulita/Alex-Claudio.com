// Counts this page view for the studio's own visit totals: the page, the site that linked here, the kind of
// device and its time zone, then how long the page stayed in front. No cookies, and nothing is saved on this device.
(() => {
  'use strict';

  // The studio dashboard marks the owner's own browsers so their visits aren't counted.
  try { if (localStorage.getItem('ac-not-counted') === '1') return; } catch (error) { /* storage is blocked; count as usual */ }
  if (navigator.webdriver) return;

  const page = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const params = new URLSearchParams(location.search);
  let path = location.pathname;
  const code = params.get('c') || '';
  if (path === '/gallery/' && /^[a-z0-9-]{6,64}$/.test(code)) path = `/gallery/${code}`;

  const ua = navigator.userAgent;
  const tablet = /iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const device = tablet ? 'Tablet' : /Mobi|iPhone|iPod|Android/i.test(ua) ? 'Mobile' : 'Desktop';
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (error) { /* no time zone */ }

  const send = (data) => {
    const body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/visit', body)) return;
    } catch (error) { /* fall back to fetch */ }
    fetch('/api/visit', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  };

  send({
    kind: 'view', page, path, referrer: document.referrer, device, tz,
    source: params.get('utm_source') || '', medium: params.get('utm_medium') || '', campaign: params.get('utm_campaign') || ''
  });

  // Time counts only while the page is in front. A running total goes out each time it is hidden.
  let shownAt = document.visibilityState === 'visible' ? Date.now() : 0;
  let seconds = 0;
  let reported = -1;
  const report = () => {
    if (shownAt) {
      seconds += (Date.now() - shownAt) / 1000;
      shownAt = 0;
    }
    const whole = Math.round(seconds);
    if (whole === reported) return;
    reported = whole;
    send({ kind: 'time', page, seconds: whole });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') report();
    else if (!shownAt) shownAt = Date.now();
  });
  addEventListener('pagehide', report);
})();
