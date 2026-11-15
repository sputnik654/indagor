/* ==========================================================================
   INDAGOR — собственный счётчик посещений (без Яндекс.Метрики и GA)
   --------------------------------------------------------------------------
   Отправляет на Netlify Function (POST /track) одно анонимное событие
   на просмотр страницы:
     path, ref (только домен источника), ua_type, lang, viewport,
     utm_source, utm_medium, utm_campaign, session_id, ts

   Чего здесь НЕТ и не должно появляться:
     • cookie — session_id живёт в sessionStorage и умирает с вкладкой;
     • IP — не передаётся и не сохраняется на сервере;
     • полный User-Agent — только тип устройства (mobile/tablet/desktop);
     • тексты, введённые в формы, и любые персональные данные.

   Подключение:
     <meta name="analytics-endpoint" content="https://<сайт>.netlify.app/track">
     <script defer src="/assets/analytics-tracker.js"></script>

   Согласие: событие уходит только после нажатия «Принять» в cookie-баннере
   (localStorage.indagor_cookie_consent === '1'). analytics.js в этот момент
   шлёт документное событие 'indagor:consent', трекер его ждёт и отправляет
   отложенный просмотр.
   ========================================================================== */
(function () {
  'use strict';

  var CONSENT_KEY = 'indagor_cookie_consent';
  var SESSION_KEY = 'indagor_sid';
  var sent = false;

  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    var v = el && el.getAttribute('content');
    return v ? String(v).trim() : '';
  }

  var ENDPOINT = meta('analytics-endpoint');
  if (!ENDPOINT || !/^https?:\/\//i.test(ENDPOINT)) return;

  function hasConsent() {
    try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch (e) { return false; }
  }

  function dnt() {
    var d = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
    return d === '1' || d === 'yes' || navigator.globalPrivacyControl === true;
  }

  /* Случайный идентификатор вкладки: не cookie, не переживает закрытие вкладки. */
  function sessionId() {
    var id = '';
    try { id = sessionStorage.getItem(SESSION_KEY) || ''; } catch (e) {}
    if (/^[a-z0-9-]{8,64}$/i.test(id)) return id;
    var rnd = '';
    try {
      var arr = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      for (var i = 0; i < arr.length; i++) rnd += ('0' + arr[i].toString(16)).slice(-2);
    } catch (e) {
      rnd = String(Date.now()) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    }
    rnd = rnd.slice(0, 32);
    try { sessionStorage.setItem(SESSION_KEY, rnd); } catch (e) {}
    return rnd;
  }

  function deviceType() {
    var ua = navigator.userAgent || '';
    if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
    if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
    var touch = (navigator.maxTouchPoints || 0) > 1;
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 820px)').matches : window.innerWidth <= 820;
    if (touch && narrow) return 'tablet';
    if (window.innerWidth <= 640 && touch) return 'mobile';
    return 'desktop';
  }

  function referrerHost() {
    var ref = document.referrer || '';
    if (!ref) return '';
    var host = '';
    try { host = new URL(ref).hostname; } catch (e) { return ''; }
    host = host.replace(/^www\./i, '').toLowerCase();
    var self = location.hostname.replace(/^www\./i, '').toLowerCase();
    return host === self ? '' : host;
  }

  function utm() {
    var out = {};
    try {
      var q = new URLSearchParams(location.search);
      ['source', 'medium', 'campaign'].forEach(function (k) {
        var v = q.get('utm_' + k);
        if (v) out['utm_' + k] = v.slice(0, 60);
      });
    } catch (e) {}
    return out;
  }

  function payload() {
    var p = {
      path: location.pathname.replace(/\/index\.html$/, '/') || '/',
      ref: referrerHost(),
      ua_type: deviceType(),
      lang: (navigator.language || navigator.userLanguage || '').toLowerCase(),
      viewport: window.innerWidth || document.documentElement.clientWidth || 0,
      session_id: sessionId(),
      ts: Date.now()
    };
    var u = utm();
    for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) p[k] = u[k];
    return p;
  }

  function send(data) {
    /* text/plain — «простой» CORS-запрос: без preflight, без cookie
       (credentials: 'omit'). keepalive позволяет дослать событие
       при закрытии вкладки. */
    try {
      var body = JSON.stringify(data);
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
      fetch(ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: body
      }).catch(function () {});
    } catch (e) {}
  }

  function track() {
    if (sent || dnt()) return;
    sent = true;
    send(payload());
  }
  window.indagorTrack = track;

  function boot() {
    if (dnt()) return;
    if (hasConsent()) { track(); return; }
    /* Ждём «Принять» — до согласия ни одного запроса наружу. */
    document.addEventListener('indagor:consent', track, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
