#!/usr/bin/env python3
"""Отчёт по собственной аналитике indagor.ru (Netlify Function GET /stats).

Переменные окружения:
    NETLIFY_STATS_URL   например https://<имя>.netlify.app/stats
    STATS_TOKEN         тот же токен, что задан в Netlify Environment variables

Примеры:
    python3 scripts/fetch_stats.py                 # последние 7 дней, Markdown
    python3 scripts/fetch_stats.py --days 30
    python3 scripts/fetch_stats.py --from 2026-11-01 --to 2026-11-15
    python3 scripts/fetch_stats.py --json          # сырой JSON ответа

Токен читается только из окружения и никогда не печатается.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

TIMEOUT = 30


def fail(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def fetch(url: str, token: str, params: dict[str, str]) -> dict:
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        f"{url}?{query}",
        headers={"x-auth-token": token, "accept": "application/json"},
        method="GET",
    )
    raw = ""
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        fail(
            f"HTTP {e.code} от /stats: {detail}\n"
            "401 — неверный STATS_TOKEN, 500 STATS_TOKEN_not_configured — переменная не задана в Netlify."
        )
    except urllib.error.URLError as e:
        fail(f"Сеть недоступна ({url}): {e.reason}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        fail(f"Ответ не JSON: {raw[:300]}")
    return {}


def bar(value: int, top: int, width: int = 20) -> str:
    if not value or top <= 0:
        return ""
    return "█" * max(1, round(value / top * width))


def table(title: str, data: dict, limit: int = 10, empty_label: str = "(прямые заходы)") -> list[str]:
    if not data:
        return [f"### {title}", "", "_Нет данных за период._", ""]
    rows = list(data.items())[:limit]
    top = rows[0][1] or 1
    out = [f"### {title}", "", "| Значение | Просмотры | |", "|---|---:|---|"]
    for key, value in rows:
        label = str(key) if str(key) else empty_label
        out.append(f"| {label} | {value} | `{bar(value, top)}` |")
    rest = len(data) - len(rows)
    if rest > 0:
        out += ["", f"_ещё {rest} без показа_"]
    return out


def by_day_table(days: dict) -> list[str]:
    if not days:
        return ["### Динамика по дням", "", "_Нет данных._"]
    values = [v for v in days.values() if isinstance(v, int)]
    top = max(values) if values else 0
    mean = round(sum(values) / len(values), 1) if values else 0
    out = ["### Динамика по дням", "", "| Дата | Просмотры | |", "|---|---:|---|"]
    for day, value in days.items():
        out.append(f"| {day} | {value} | `{bar(value, top)}` |")
    out += ["", f"Среднее в день: **{mean}**, максимум: **{top}**."]
    return out


def hours_block(hours: list) -> list[str]:
    if not any(hours):
        return []
    peak = max(hours)
    peak_hour = hours.index(peak)
    out = [f"### Часы активности (МСК), пик {peak_hour:02d}:00 — {peak} просмотров", "",
           "| Часы | Просмотры |", "|---|---|"]
    for start in range(0, 24, 3):
        total = sum(hours[start:start + 3])
        out.append(f"| {start:02d}–{start + 2:02d} | {total} |")
    return out


def render(payload: dict) -> str:
    total = int(payload.get("total") or 0)
    lines = [
        "# Статистика indagor.ru",
        "",
        f"**Период:** {payload.get('from')} … {payload.get('to')}  ",
        f"**Событий:** {total}  **Сессий (вкладок):** {payload.get('sessions', 0)}  "
        f"**Дней с данными:** {payload.get('days_with_data')} из {payload.get('days')}",
    ]
    if payload.get("read_errors"):
        lines.append(f"**Ошибки чтения хранилища:** {payload['read_errors']}")
    if not total:
        lines += ["", "> За период не зафиксировано ни одного события. Проверь, что `analytics-endpoint` "
                      "в `<meta>` указывает на рабочий адрес функции и что посетитель нажал «Принять» "
                      "в cookie-баннере (до согласия счётчик молчит)."]
        return "\n".join(lines)

    lines += [""] + table("Топ страниц", payload.get("by_page") or {}, limit=12)
    lines += [""] + table("Источники перехода (домен)", payload.get("by_ref") or {}, limit=10)
    lines += [""] + by_day_table(payload.get("by_day") or {})
    lines += [""] + table("Устройства", payload.get("by_device") or {})
    lines += [""] + table("Язык браузера", payload.get("by_lang") or {})
    if payload.get("by_utm_source"):
        lines += [""] + table("UTM source", payload["by_utm_source"])
    hours = hours_block(payload.get("by_hour") or [])
    if hours:
        lines += [""] + hours
    lines += ["", f"_Сформировано: {datetime.now().strftime('%Y-%m-%d %H:%M')} · данные Netlify Blobs, "
                  "персональные данные не собираются._"]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="Отчёт по /stats собственной аналитики indagor.ru")
    ap.add_argument("--days", type=int, default=7, help="последних дней (по умолчанию 7)")
    ap.add_argument("--from", dest="date_from", help="начало, YYYY-MM-DD")
    ap.add_argument("--to", dest="date_to", help="конец, YYYY-MM-DD")
    ap.add_argument("--url", default=os.environ.get("NETLIFY_STATS_URL", ""), help="URL функции /stats")
    ap.add_argument("--json", action="store_true", help="вывести сырой JSON")
    args = ap.parse_args()

    url = (args.url or "").strip()
    token = (os.environ.get("STATS_TOKEN") or "").strip()
    if not url:
        fail("Не задан NETLIFY_STATS_URL (пример: https://indagor-analytics.netlify.app/stats)")
    if not token:
        fail("Не задан STATS_TOKEN в окружении")
    if args.days < 1:
        fail("--days должен быть ≥ 1")

    if args.date_from or args.date_to:
        to = args.date_to or date.today().isoformat()
        frm = args.date_from or (date.fromisoformat(to) - timedelta(days=args.days - 1)).isoformat()
    else:
        to = date.today().isoformat()
        frm = (date.fromisoformat(to) - timedelta(days=args.days - 1)).isoformat()

    try:
        date.fromisoformat(frm)
        date.fromisoformat(to)
    except ValueError:
        fail("Даты должны быть в формате YYYY-MM-DD")

    payload = fetch(url, token, {"from": frm, "to": to})
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    print(render(payload))
    return 0


if __name__ == "__main__":
    sys.exit(main())
