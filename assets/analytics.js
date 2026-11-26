/* ==========================================================================
   INDAGOR — согласие на cookie и отложенная загрузка аналитики
   Яндекс.Метрика (114183010) подключается ТОЛЬКО после нажатия «Принять»
   (localStorage: indagor_cookie_consent='1'). При отказе (='0') счётчик не
   инициализируется вовсе, баннер больше не показывается.
   Google Analytics / Google Tag Manager на сайте не используются.
   Скрипт Метрики вставляется динамически с async — загрузка страницы не блокируется.
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'indagor_cookie_consent';
  var METRIKA_ID = 114183010;
  var started = false;

  function getConsent() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setConsent(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
  }

  function broadcastConsent(accepted) {
    try {
      document.dispatchEvent(new CustomEvent('indagor:consent', { detail: { accepted: accepted } }));
    } catch (e) {}
  }

  function startMetrika() {
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = 1 * new Date();
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://mc.yandex.ru/metrika/tag.js';
    (document.head || document.documentElement).appendChild(s);
    window.ym(METRIKA_ID, 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: true
    });
  }

  function loadAnalytics() {
    if (started) return;
    started = true;
    startMetrika();
  }
  window.indagorLoadAnalytics = loadAnalytics;

  function hideBanner(bar) {
    if (!bar) return;
    bar.hidden = true;
    document.body.classList.remove('has-cookie');
  }

  function showBanner() {
    var bar = document.getElementById('cookieBar');
    if (!bar) return;
    bar.hidden = false;
    document.body.classList.add('has-cookie');

    var accept = document.getElementById('cookieAccept');
    if (accept) {
      accept.addEventListener('click', function () {
        setConsent('1');
        hideBanner(bar);
        loadAnalytics();
        broadcastConsent(true);
      });
    }

    var reject = document.getElementById('cookieReject');
    if (reject) {
      reject.addEventListener('click', function () {
        setConsent('0');
        hideBanner(bar);
        broadcastConsent(false);
      });
    }
  }

  function boot() {
    var consent = getConsent();
    if (consent === '1') { loadAnalytics(); return; }
    if (consent === '0') { return; }          /* отказ запомнен — ни баннера, ни Метрики */
    showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
