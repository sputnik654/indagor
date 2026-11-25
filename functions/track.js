/**
 * INDAGOR — приём анонимных событий аналитики (Cloudflare Pages Functions + D1).
 *
 * POST /track  {path, ref, ua_type, lang, viewport, utm_source, utm_medium,
 *               utm_campaign, session_id, ts}
 *
 * Что НЕ сохраняется: IP-адрес, полный User-Agent, cookie, любые ПДн.
 * Хранилище: D1, таблица events; день считается по Москве (UTC+3).
 *
 * Ответ: 200 {ok:true} | 200 {ok:true, skipped:"…"} | 400/405/500 {error:"…"}
 */

const MAX_EVENTS_PER_DAY = 10000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

const BOT_PATTERNS = [
  "googlebot", "google-inspectiontool", "googleother", "google-read-aloud",
  "adsbot-google", "mediapartners-google",
  "yandexbot", "yandex.com/bots", "yandeximages", "yandexadditional", "yabot",
  "bingbot", "bingpreview", "msnbot", "adidxbot",
  "baiduspider", "sogou", "exabot", "seznambot", "petalbot", "bytespider",
  "duckduckbot", "slurp", "yeti", "naverbot", "daumoa", "qwantify",
  "ahrefsbot", "semrushbot", "mj12bot", "dotbot", "blexbot", "screaming frog",
  "rogerbot", "serpstatbot", "dataforseo", "megaindex", "linkpadbot",
  "applebot", "facebookexternalhit", "twitterbot", "linkedinbot", "telegrambot",
  "whatsapp", "slackbot", "discordbot", "embedly", "pinterestbot", "redditbot",
  "headlesschrome", "phantomjs", "lighthouse", "pagespeed", "pingdom",
  "uptimerobot", "statuscake", "site24x7", "newrelicpinger", "datadog",
  "curl/", "wget/", "python-requests", "python-urllib", "aiohttp", "httpx",
  "go-http-client", "okhttp", "axios/", "node-fetch", "java/", "libwww-perl",
  "zgrab", "masscan", "nmap", "censys", "expanse"
];
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const BOT_RE = /(bot|crawler|crawl|spider|slurp|scraper|preview|monitor|uptime|headless|phantom|scan)/i;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400"
};

function reply(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...extra
    }
  });
}

function dayKey(date = new Date()) {
  return new Date(date.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

function isBot(ua) {
  if (!ua || ua.length < 10) return true;
  if (ua.length > 512) return true;
  const low = ua.toLowerCase();
  if (BOT_PATTERNS.some((p) => low.includes(p))) return true;
  return BOT_RE.test(low);
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function hostOnly(v) {
  const raw = str(v, 300);
  if (!raw) return "";
  let host = raw;
  try {
    host = new URL(raw).hostname;
  } catch {
    host = raw.split("/")[0].split("?")[0];
  }
  host = host.replace(/^www\./i, "").toLowerCase().replace(/[^a-z0-9.-]/g, "");
  if (!HOST_RE.test(host)) return "";
  return host.slice(0, 100);
}

function cleanPath(v) {
  let p = str(v, 300).split("?")[0].split("#")[0];
  if (!p) return "/";
  if (!p.startsWith("/")) p = "/" + p;
  return p.replace(/[^\p{L}\p{N}/._~%-]/gu, "").slice(0, 300) || "/";
}

function cleanDevice(v) {
  return v === "mobile" || v === "tablet" || v === "desktop" ? v : "unknown";
}

function cleanLang(v) {
  return str(v, 8).toLowerCase().replace(/[^a-z-]/g, "").slice(0, 8);
}

function cleanSid(v) {
  return str(v, 64).replace(/[^a-zA-Z0-9-]/g, "");
}

function cleanInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

const TYPES = { pageview: "pv", consent_granted: "cg", duration: "dr" };

function buildEvent(body, now) {
  const tsRaw = Number(body.ts);
  const ts =
    Number.isFinite(tsRaw) && tsRaw > now - 2 * 86400000 && tsRaw < now + 3600000
      ? Math.round(tsRaw)
      : now;

  const type = TYPES[body.type] || "pv";
  const consent = body.consent === true;

  const ev = {
    ts,
    day: dayKey(new Date(ts)),
    ty: type,
    c: consent ? 1 : 0,
    p: cleanPath(body.path),
    d: cleanDevice(body.ua_type),
    l: cleanLang(body.lang),
    w: cleanInt(body.viewport, 0, 20000),
    dur: null,
    r: "",
    sid: "",
    u_src: "",
    u_med: "",
    u_cmp: ""
  };
  if (type === "dr") ev.dur = cleanInt(body.duration, 0, 7200);

  ev.r = hostOnly(body.ref);
  /* session_id пишем только при согласии: анонимное событие не должно
     связывать просмотры между собой. */
  if (consent) ev.sid = cleanSid(body.session_id);
  ev.u_src = str(body.utm_source, 60).toLowerCase().replace(/[^\p{L}\p{N}._-]/gu, "");
  ev.u_med = str(body.utm_medium, 60).toLowerCase().replace(/[^\p{L}\p{N}._-]/gu, "");
  ev.u_cmp = str(body.utm_campaign, 60).replace(/[^\p{L}\p{N}._| -]/gu, "").replace(/\s+/g, " ").trim();

  return ev;
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return reply(405, { error: "method_not_allowed" }, { allow: "POST, OPTIONS" });
  }

  /* Отказ от отслеживания уважается и на сервере, не только в браузере. */
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") {
    return reply(200, { ok: true, skipped: "dnt" });
  }
  if (isBot(request.headers.get("user-agent"))) {
    return reply(200, { ok: true, skipped: "bot" });
  }

  let body;
  try {
    const raw = await request.text();
    if (!raw || raw.length > 4000) return reply(400, { error: "bad_payload" });
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "bad_json" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply(400, { error: "bad_payload" });
  }

  const now = Date.now();
  const ev = buildEvent(body, now);

  try {
    const cap = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE day = ?")
      .bind(ev.day)
      .first();
    if ((cap?.n ?? 0) >= MAX_EVENTS_PER_DAY) {
      return reply(200, { ok: true, skipped: "day_cap" });
    }

    await env.DB.prepare(
      `INSERT INTO events (ts, day, ty, c, p, d, l, w, dur, r, sid, u_src, u_med, u_cmp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(ev.ts, ev.day, ev.ty, ev.c, ev.p, ev.d, ev.l, ev.w, ev.dur, ev.r,
            ev.sid, ev.u_src, ev.u_med, ev.u_cmp)
      .run();

    return reply(200, { ok: true });
  } catch (err) {
    console.error("track: write failed", err?.message || err);
    return reply(500, { error: "storage_error" });
  }
}
