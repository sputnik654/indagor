/* INDAGOR — счётчик. Всегда: анонимный pageview (без cookie, IP, session_id).
   После согласия: событие consent_granted + session_id и сторонние счётчики
   (analytics.js: Метрика/GTM).
   Время на странице — только АКТИВНОЕ: таймер идёт при
   document.visibilityState === 'visible' и встаёт на паузу, когда вкладка
   скрыта (ушли в другую вкладку/свернули окно). Каждый активный отрезок
   отправляется отдельным событием duration, поэтому в отчёте avg_duration_sec —
   средняя длительность активного отрезка, а их сумма — чистое время на странице
   без фонового «висения». */
(function () {
  var m = document.querySelector('meta[name="analytics-endpoint"]'), url = m && m.getAttribute('content');
  if (!url || !/^https?:\/\//i.test(url = url.trim())) return;
  url = url.replace(/\/\.netlify\/functions\//, '/');   /* старый путь = 404 */
  var n = navigator, KEY = 'indagor_sid', sent = 0, segs = 0;
  var t0 = Date.now(), act = 0, vis = document.visibilityState !== 'hidden';

  function ok() { try { return localStorage.getItem('indagor_cookie_consent') === '1'; } catch (e) { return 0; } }
  function dnt() { var d = n.doNotTrack || window.doNotTrack; return d === '1' || d === 'yes' || n.globalPrivacyControl; }
  function sid() {   /* только с согласием: 16 симв, sessionStorage */
    var v = '', i, a = new Uint8Array(8);
    try { v = sessionStorage.getItem(KEY) || ''; } catch (e) {}
    if (/^[a-z0-9]{16}$/i.test(v)) return v;
    try { n.crypto.getRandomValues(a); } catch (e) { for (i = 0; i < 8; i++) a[i] = Math.random() * 256; }
    for (v = '', i = 0; i < 8; i++) v += ('0' + a[i].toString(16)).slice(-2);
    try { sessionStorage.setItem(KEY, v); } catch (e) {}
    return v;
  }
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
  var urls = url.split('|');   /* первый адрес — основной, второй — резервный */
  function send(b) {
    var i = 0;
    function one(u) {
      return fetch(u, { method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: b })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r; });
    }
    (function next() {   /* при 4xx/5xx/сети — следующий адрес; ошибки не всплывают наружу */
      if (i >= urls.length) return;
      one(urls[i++].trim()).catch(next);
    })();
  }
  function ev(type, extra) {
    var c = ok(), q = null, k;
    var p = {
      type: type, consent: c, path: location.pathname.replace(/\/index\.html$/, '/') || '/',
      ref: ref(), ua_type: device(), lang: (n.language || '').toLowerCase(),
      viewport: innerWidth || document.documentElement.clientWidth || 0, ts: Date.now()
    };
    if (c) p.session_id = sid();   /* анонимное событие без идентификатора вкладки */
    try { q = new URLSearchParams(location.search); } catch (e) {}
    if (q) ['source', 'medium', 'campaign'].forEach(function (u) {
      var v = q.get('utm_' + u); if (v) p['utm_' + u] = v.slice(0, 60);
    });
    if (extra) for (k in extra) p[k] = extra[k];
    send(JSON.stringify(p));
  }
  function pageview() { if (sent || dnt()) return; sent = 1; ev('pageview'); }
  function duration() {
    if (vis) { act += Date.now() - t0; t0 = Date.now(); }   /* накопить видимый отрезок */
    var s = Math.round(act / 1000);
    if (segs >= 20 || dnt() || s < 2) return;   /* <2 с — шум, >20 отрезков — защита от спама */
    act = 0; segs++;
    ev('duration', { duration: s });
  }
  window.indagorTrack = pageview;

  pageview();   /* анонимно, до любого согласия; DNT уважается */
  if (!ok()) document.addEventListener('indagor:consent', function () { ev('consent_granted'); }, { once: true });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { duration(); vis = false; }   /* пауза: отрезок закрыт */
    else if (!vis) { vis = true; t0 = Date.now(); }                            /* снова активны — новый отрезок */
  });
  addEventListener('pagehide', duration);   /* финальный отрезок при уходе со страницы */
})();
