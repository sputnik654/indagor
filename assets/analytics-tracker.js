/* INDAGOR — счётчик: анонимный просмотр → POST /track. Без cookie, без IP,
   без полного UA. Только после согласия (флаг indagor_cookie_consent='1'
   или событие 'indagor:consent'). Endpoint — meta analytics-endpoint. */
(function () {
  var m = document.querySelector('meta[name="analytics-endpoint"]'), url = m && m.getAttribute('content'), s;
  if (!url || !/^https?:\/\//i.test(url = url.trim())) return;
  var n = navigator, KEY = 'indagor_sid', sent = 0;
  function ok() { try { return localStorage.getItem('indagor_cookie_consent') === '1'; } catch (e) { return 0; } }
  function dnt() { var d = n.doNotTrack || window.doNotTrack; return d === '1' || d === 'yes' || n.globalPrivacyControl; }
  var sid = function () {   /* 16 символов, sessionStorage, не cookie */
    var v = '', i, a = new Uint8Array(8);
    try { v = sessionStorage.getItem(KEY) || ''; } catch (e) {}
    if (/^[a-z0-9]{16}$/i.test(v)) return v;
    try { n.crypto.getRandomValues(a); } catch (e) { for (i = 0; i < 8; i++) a[i] = Math.random() * 256; }
    for (v = '', i = 0; i < 8; i++) v += ('0' + a[i].toString(16)).slice(-2);
    try { sessionStorage.setItem(KEY, v); } catch (e) {}
    return v;
  };
  function device() {
    var ua = n.userAgent, w = innerWidth || document.documentElement.clientWidth, t = n.maxTouchPoints > 1;
    if (/iPad|Tablet|Silk|PlayBook|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
    if (/Mobi|iPhone|iPod|Android|Windows Phone|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
    return t && w <= 640 ? 'mobile' : t && w <= 900 ? 'tablet' : 'desktop';
  }
  function ref() {
    if (!document.referrer) return '';
    var h; try { h = new URL(document.referrer).hostname; } catch (e) { return ''; }
    h = h.replace(/^www\./i, '').toLowerCase();
    return h === location.hostname.replace(/^www\./i, '').toLowerCase() ? '' : h;
  }
  function track() {
    if (sent || dnt()) return;
    sent = 1;
    var p = {
      path: location.pathname.replace(/\/index\.html$/, '/') || '/', ref: ref(), ua_type: device(),
      lang: (n.language || '').toLowerCase(), viewport: innerWidth || document.documentElement.clientWidth || 0,
      session_id: sid(), ts: Date.now()
    }, q = null;
    try { q = new URLSearchParams(location.search); } catch (e) {}
    if (q) ['source', 'medium', 'campaign'].forEach(function (k) {
      var v = q.get('utm_' + k); if (v) p['utm_' + k] = v.slice(0, 60);
    });
    var b = JSON.stringify(p);
    try {   /* text/plain — без preflight: sendBeacon его не умеет */
      if (n.sendBeacon && n.sendBeacon(url, new Blob([b], { type: 'text/plain;charset=UTF-8' }))) return;
      fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: b }).catch(function () {});
    } catch (e) {}
  }
  window.indagorTrack = track;
  if (ok()) track(); else document.addEventListener('indagor:consent', track, { once: true });
})();
