/**
 * INDAGOR — чтение агрегированной статистики (Cloudflare Pages Functions + D1).
 *
 * GET /stats?from=YYYY-MM-DD&to=YYYY-MM-DD   (по умолчанию — последние 7 дней)
 * Заголовок: x-auth-token: <STATS_TOKEN>      (секрет Pages-проекта)
 *
 * Агрегаты: total, sessions, by_page, by_ref, by_day, by_device, by_lang,
 *           by_hour (0…23, московское время), by_utm_source.
 */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86400000;
const MAX_DAYS = 366;

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

function ranked(rows) {
  const out = {};
  for (const r of rows || []) out[r.k ?? ""] = r.n;
  return out;
}

async function pairs(db, sql, args) {
  const res = await db.prepare(sql).bind(...args).all();
  return ranked(res.results || []);
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET") {
    return reply(405, { error: "method_not_allowed" }, { allow: "GET, OPTIONS" });
  }

  const expected = env.STATS_TOKEN;
  if (!expected) return reply(500, { error: "STATS_TOKEN_not_configured" });
  if (!sameToken(request.headers.get("x-auth-token") || "", expected)) {
    return reply(401, { error: "unauthorized" });
  }

  const url = new URL(request.url);
  const today = mskDay(Date.now());
  const to = url.searchParams.get("to") || today;
  const from = url.searchParams.get("from") || mskDay(Date.parse(to + "T00:00:00Z") - 6 * DAY_MS);

  if (!isDayKey(from) || !isDayKey(to)) return reply(400, { error: "bad_date_format", hint: "YYYY-MM-DD" });
  if (from > to) return reply(400, { error: "from_after_to" });
  const days = dayRange(from, to);
  if (!days.length) return reply(400, { error: "empty_range" });
  if (days.length > MAX_DAYS) return reply(400, { error: "range_too_long", max_days: MAX_DAYS });

  const db = env.DB;
  const args = [from, to];

  try {
    const totals = await db
      .prepare(
        `SELECT
           SUM(CASE WHEN ty = 'pv' THEN 1 ELSE 0 END) AS total,
           SUM(CASE WHEN ty = 'pv' AND c = 0 THEN 1 ELSE 0 END) AS anonymous,
           SUM(CASE WHEN ty = 'pv' AND c = 1 THEN 1 ELSE 0 END) AS consented,
           SUM(CASE WHEN ty = 'cg' THEN 1 ELSE 0 END) AS consents,
           COUNT(DISTINCT CASE WHEN ty = 'pv' AND c = 1 AND sid <> '' THEN sid END) AS sessions,
           COUNT(DISTINCT CASE WHEN ty IN ('pv','cg','dr') THEN day END) AS days_with_data
         FROM events WHERE day BETWEEN ? AND ?`
      )
      .bind(...args)
      .first();

    const dur = await db
      .prepare(`SELECT AVG(dur) AS avg_dur, COUNT(*) AS n FROM events WHERE ty = 'dr' AND day BETWEEN ? AND ?`)
      .bind(...args)
      .first();

    const byPage = await pairs(db,
      `SELECT p AS k, COUNT(*) AS n FROM events WHERE ty = 'pv' AND day BETWEEN ? AND ? GROUP BY p ORDER BY n DESC, k ASC`, args);
    const byRef = await pairs(db,
      `SELECT COALESCE(r,'') AS k, COUNT(*) AS n FROM events WHERE ty = 'pv' AND day BETWEEN ? AND ? GROUP BY r ORDER BY n DESC, k ASC`, args);
    const byDevice = await pairs(db,
      `SELECT d AS k, COUNT(*) AS n FROM events WHERE ty = 'pv' AND day BETWEEN ? AND ? GROUP BY d ORDER BY n DESC, k ASC`, args);
    const byLang = await pairs(db,
      `SELECT CASE WHEN substr(l,1,2) = 'ru' THEN 'ru' WHEN substr(l,1,2) = 'en' THEN 'en' ELSE 'other' END AS k,
              COUNT(*) AS n
       FROM events WHERE ty = 'pv' AND day BETWEEN ? AND ?
       GROUP BY k ORDER BY n DESC, k ASC`, args);
    const byUtm = await pairs(db,
      `SELECT COALESCE(u_src,'') AS k, COUNT(*) AS n FROM events WHERE ty = 'pv' AND day BETWEEN ? AND ?
       AND u_src <> '' GROUP BY u_src ORDER BY n DESC, k ASC`, args);

    const perDay = await db
      .prepare(`SELECT day AS k, COUNT(*) AS n FROM events WHERE ty = 'pv' AND day BETWEEN ? AND ? GROUP BY day`)
      .bind(...args)
      .all();
    const dayMap = {};
    for (const r of perDay.results || []) dayMap[r.k] = r.n;

    const hours = await db
      .prepare(
        `SELECT CAST(strftime('%H', ts/1000, 'unixepoch', '+3 hours') AS INTEGER) AS h, COUNT(*) AS n
         FROM events WHERE ty = 'pv' AND day BETWEEN ? AND ? GROUP BY h`
      )
      .bind(...args)
      .all();
    const byHour = new Array(24).fill(0);
    for (const r of hours.results || []) {
      const h = Number(r.h);
      if (Number.isInteger(h) && h >= 0 && h < 24) byHour[h] = r.n;
    }

    const byDaySeries = {};
    for (const d of days) byDaySeries[d] = dayMap[d] || 0;

    const total = totals?.total || 0;
    const anonymous = totals?.anonymous || 0;
    const consented = totals?.consented || 0;
    const samples = dur?.n || 0;
    const avgDuration = samples ? Math.round(Number(dur.avg_dur) * 10) / 10 : 0;

    return reply(200, {
      from,
      to,
      days: days.length,
      days_with_data: totals?.days_with_data || 0,
      read_errors: 0,
      generated_at: new Date().toISOString(),
      total,
      total_anonymous: anonymous,
      total_consented: consented,
      anonymous_share: total ? Math.round((anonymous / total) * 1000) / 10 : 0,
      consents: totals?.consents || 0,
      sessions: totals?.sessions || 0,
      avg_duration_sec: avgDuration,
      duration_samples: samples,
      by_page: byPage,
      by_ref: byRef,
      by_day: byDaySeries,
      by_device: byDevice,
      by_lang: byLang,
      by_hour: byHour,
      by_utm_source: byUtm
    });
  } catch (err) {
    console.error("stats: query failed", err?.message || err);
    return reply(500, { error: "storage_error", detail: String(err?.message || err).slice(0, 200) });
  }
}
