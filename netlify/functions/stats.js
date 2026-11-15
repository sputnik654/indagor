/**
 * INDAGOR — чтение агрегированной статистики.
 *
 * GET /stats?from=YYYY-MM-DD&to=YYYY-MM-DD   (по умолчанию — последние 7 дней)
 * Заголовок: x-auth-token: <STATS_TOKEN>      (переменная окружения Netlify)
 *
 * Агрегаты: total, sessions, by_page, by_ref, by_day, by_device, by_lang,
 *           by_hour (0…23, московское время), by_utm_source.
 * Источник: Netlify Blobs, store "analytics", ключи events/YYYY-MM-DD.json.
 */
import { getStore } from "@netlify/blobs";

export const config = { path: "/stats" };

const STORE_NAME = "analytics";
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86400000;
const MAX_DAYS = 366;
const READ_CONCURRENCY = 8;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "x-auth-token, content-type",
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

function mskDay(ms) {
  return new Date(ms + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

function isDayKey(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
}

function dayRange(from, to) {
  const out = [];
  let t = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  while (t <= end && out.length <= MAX_DAYS) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += DAY_MS;
  }
  return out;
}

function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Объект-счётчик → отсортированный по убыванию массив [ключ, значение]. */
function ranked(map) {
  return Object.fromEntries(
    Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  );
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "GET") {
    return reply(405, { error: "method_not_allowed" }, { allow: "GET, OPTIONS" });
  }

  const expected = process.env.STATS_TOKEN;
  if (!expected) {
    return reply(500, { error: "STATS_TOKEN_not_configured" });
  }
  if (!sameToken(req.headers.get("x-auth-token") || "", expected)) {
    return reply(401, { error: "unauthorized" });
  }

  const url = new URL(req.url);
  const today = mskDay(Date.now());
  const to = url.searchParams.get("to") || today;
  const fromParam = url.searchParams.get("from");
  const from = fromParam || mskDay(Date.parse(to + "T00:00:00Z") - 6 * DAY_MS);

  if (!isDayKey(from) || !isDayKey(to)) {
    return reply(400, { error: "bad_date_format", hint: "YYYY-MM-DD" });
  }
  if (from > to) return reply(400, { error: "from_after_to" });
  const days = dayRange(from, to);
  if (!days.length) return reply(400, { error: "empty_range" });
  if (days.length > MAX_DAYS) return reply(400, { error: "range_too_long", max_days: MAX_DAYS });

  let store;
  try {
    store = getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (err) {
    console.error("stats: store unavailable", err?.message || err);
    return reply(500, { error: "storage_unavailable" });
  }

  const byPage = {};
  const byRef = {};
  const byDay = {};
  const byDevice = {};
  const byLang = {};
  const byHour = new Array(24).fill(0);
  const byUtm = {};
  const sessions = new Set();
  let total = 0;
  let daysWithData = 0;
  let errors = 0;

  for (let i = 0; i < days.length; i += READ_CONCURRENCY) {
    const chunk = days.slice(i, i + READ_CONCURRENCY);
    const values = await Promise.all(
      chunk.map((day) =>
        store
          .get(`events/${day}.json`, { type: "json" })
          .then((v) => ({ ok: true, v }))
          .catch((err) => {
            console.error(`stats: read failed ${day}`, err?.message || err);
            return { ok: false };
          })
      )
    );

    values.forEach(({ ok, v: events }, idx) => {
      const day = chunk[idx];
      if (!ok) {
        errors++;
        return;
      }
      if (!Array.isArray(events)) return;
      if (!events.length) return;
      daysWithData++;
      byDay[day] = events.length;
      total += events.length;
      for (const e of events) {
        if (!e || typeof e !== "object") continue;
        bump(byPage, typeof e.p === "string" && e.p ? e.p : "/");
        bump(byRef, typeof e.r === "string" && e.r ? e.r : "");
        bump(byDevice, e.d === "mobile" || e.d === "tablet" || e.d === "desktop" ? e.d : "unknown");

        const lang = typeof e.l === "string" ? e.l.slice(0, 2).toLowerCase() : "";
        bump(byLang, lang === "ru" ? "ru" : lang === "en" ? "en" : "other");

        const ts = Number(e.t);
        if (Number.isFinite(ts)) {
          const hour = new Date(ts + MSK_OFFSET_MS).getUTCHours();
          byHour[hour] += 1;
        }
        if (typeof e.u_src === "string" && e.u_src) bump(byUtm, e.u_src);
        if (typeof e.sid === "string" && e.sid) sessions.add(e.sid);
      }
    });
  }

  /* Дни без данных показываем нулями: временной ряд должен быть непрерывным. */
  const byDaySeries = {};
  for (const day of days) byDaySeries[day] = byDay[day] || 0;

  return reply(200, {
    from,
    to,
    days: days.length,
    days_with_data: daysWithData,
    read_errors: errors,
    generated_at: new Date().toISOString(),
    total,
    sessions: sessions.size,
    by_page: ranked(byPage),
    by_ref: ranked(byRef),
    by_day: byDaySeries,
    by_device: ranked(byDevice),
    by_lang: ranked(byLang),
    by_hour: byHour,
    by_utm_source: ranked(byUtm)
  });
};
