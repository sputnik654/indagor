/* ==========================================================================
   INDAGOR — согласие на cookie и отложенная загрузка аналитики
   Яндекс.Метрика (114183010) и Google Tag Manager (GTM-NC82SDKL) грузятся
   ТОЛЬКО после нажатия «Принять» (localStorage: indagor_cookie_consent='1').
   До согласия window.ym и window.dataLayer не создаются, сторонних
   запросов к mc.yandex.ru / googletagmanager.com нет.
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'indagor_cookie_consent';
  var METRIKA_ID = 114183010;
  var GTM_ID = 'GTM-NC82SDKL';
  var started = false;

  function hasConsent() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function saveConsent() {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
  }

  function startGTM() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(GTM_ID);
    (document.head || document.documentElement).appendChild(s);
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
    startGTM();
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
    var btn = document.getElementById('cookieAccept');
    if (btn) {
      btn.addEventListener('click', function () {
        saveConsent();
        hideBanner(bar);
        loadAnalytics();
      });
    }
  }

  function boot() {
    if (hasConsent()) { loadAnalytics(); return; }
    showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
