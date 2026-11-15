/**
 * INDAGOR — приём анонимных событий аналитики.
 *
 * POST /track  {path, ref, ua_type, lang, viewport, utm_source, utm_medium,
 *               utm_campaign, session_id, ts}
 *
 * Что НЕ сохраняется: IP-адрес, полный User-Agent, cookie, любые ПДн.
 * Хранилище: Netlify Blobs, store "analytics", ключ events/YYYY-MM-DD.json —
 * массив событий за день (день считается по Москве, UTC+3).
 *
 * Ответ: 200 {ok:true} | 200 {ok:true, skipped:"…"} | 400/405/500 {error:"…"}
 */
import { getStore } from "@netlify/blobs";

export const config = { path: "/track" };

const STORE_NAME = "analytics";
const MAX_EVENTS_PER_DAY = 10000;
const MAX_WRITE_ATTEMPTS = 6;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000; // Москва, без перехода на летнее время

/* Боты и служебные агенты: 30+ шаблонов + общий хвост. Список проверяется
   по нижнему регистру User-Agent. */
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

/* Путь для ключа дня: дата по Москве. */
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
  /* Сохраняем только правдоподобное доменное имя: «javascript», «about» и прочий
     мусор в referrer превращается в пустую строку (= прямой заход). */
  if (!HOST_RE.test(host)) return "";
  return host.slice(0, 100);
}

function cleanPath(v) {
  let p = str(v, 300).split("?")[0].split("#")[0];
  if (!p) return "/";
  if (!p.startsWith("/")) p = "/" + p;
  /* Оставляем буквы (в том числе кириллицу), цифры, «/», «.», «-», «_», «~», «%». */
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

/* Типы событий: pv — просмотр страницы, cg — «Принять» в баннере,
   dr — время на странице (duration). */
const TYPES = { pageview: "pv", consent_granted: "cg", duration: "dr" };

/* Собрать компактное событие: короткие ключи экономят размер блоба,
   пустые строки не пишем вовсе. */
function buildEvent(body, now) {
  const tsRaw = Number(body.ts);
  const ts =
    Number.isFinite(tsRaw) && tsRaw > now - 2 * 86400000 && tsRaw < now + 3600000
      ? Math.round(tsRaw)
      : now;

  const type = TYPES[body.type] || "pv";
  const consent = body.consent === true;

  const ev = {
    t: ts,
    ty: type,
    c: consent ? 1 : 0,
    p: cleanPath(body.path),
    d: cleanDevice(body.ua_type),
    l: cleanLang(body.lang),
    w: cleanInt(body.viewport, 0, 20000)
  };
  if (type === "dr") ev.dur = cleanInt(body.duration, 0, 7200);

  const ref = hostOnly(body.ref);
  if (ref) ev.r = ref;
  /* session_id пишем только при согласии: анонимное событие не должно
     связывать просмотры между собой. */
  const sid = consent ? cleanSid(body.session_id) : "";
  if (sid) ev.sid = sid;
  const src = str(body.utm_source, 60).toLowerCase().replace(/[^\p{L}\p{N}._-]/gu, "");
  if (src) ev.u_src = src;
  const med = str(body.utm_medium, 60).toLowerCase().replace(/[^\p{L}\p{N}._-]/gu, "");
  if (med) ev.u_med = med;
  const cmp = str(body.utm_campaign, 60).replace(/[^\p{L}\p{N}._| -]/gu, "").replace(/\s+/g, " ").trim();
  if (cmp) ev.u_cmp = cmp;

  return ev;
}

/* Чтение-изменение-запись с оптимистичной блокировкой по ETag:
   Netlify Blobs не даёт транзакций, но setJSON({onlyIfMatch}) возвращает
   modified:false при конфликте — тогда перечитываем и пробуем снова. */
async function appendEvent(store, key, event) {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const entry = await store.getWithMetadata(key, { type: "json" });
    const events = Array.isArray(entry?.data) ? entry.data : [];

    if (events.length >= MAX_EVENTS_PER_DAY) {
      return { skipped: "day_cap", count: events.length };
    }

    events.push(event);
    const res = entry?.etag
      ? await store.setJSON(key, events, { onlyIfMatch: entry.etag })
      : await store.setJSON(key, events, { onlyIfNew: true });

    if (res?.modified !== false) return { count: events.length };
    await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
  }
  throw new Error("write_conflict");
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return reply(405, { error: "method_not_allowed" }, { allow: "POST, OPTIONS" });
  }

  /* Отказ от отслеживания уважается и на сервере, не только в браузере. */
  if (req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1") {
    return reply(200, { ok: true, skipped: "dnt" });
  }

  if (isBot(req.headers.get("user-agent"))) {
    return reply(200, { ok: true, skipped: "bot" });
  }

  let body;
  try {
    const raw = await req.text();
    if (!raw || raw.length > 4000) return reply(400, { error: "bad_payload" });
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "bad_json" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply(400, { error: "bad_payload" });
  }

  const now = Date.now();
  const event = buildEvent(body, now);

  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const key = `events/${dayKey(new Date(now))}.json`;
    const result = await appendEvent(store, key, event);
    if (result.skipped) return reply(200, { ok: true, skipped: result.skipped });
    return reply(200, { ok: true });
  } catch (err) {
    console.error("track: write failed", err?.message || err);
    return reply(500, { error: "storage_error" });
  }
};
