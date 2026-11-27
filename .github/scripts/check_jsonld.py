#!/usr/bin/env python3
"""Валидация JSON-LD на живых страницах: валидный JSON, Product с обязательными полями,
AI-файлы парсятся и не содержат Product без offers/review/aggregateRating.

Запуск: python3 .github/scripts/check_jsonld.py indagor.ru indagor.online
"""
import json
import re
import sys
import time
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


RETRY_CODES = (429, 500, 502, 503, 504)


def get(url, attempts=4):
    """Чтение URL с повторами: GitHub Pages периодически отдаёт 503, пока идёт
    пересборка (и Varnish на краю — под нагрузкой), а одиночный 503 не означает
    поломку и не должен красить мониторинг в красный."""
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in RETRY_CODES or i == attempts - 1:
                raise
        except Exception as e:  # таймауты, TLS, обрывы
            last = e
            if i == attempts - 1:
                raise
        time.sleep(2 * (i + 1))
    raise last


def blocks(html):
    return re.findall(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
                      html, re.S)


def walk_products(node, out):
    if isinstance(node, dict):
        if node.get("@type") == "Product":
            out.append(node)
        for v in node.values():
            walk_products(v, out)
    elif isinstance(node, list):
        for v in node:
            walk_products(v, out)


def main(hosts):
    fail = 0
    for host in hosts:
        print(f"\n=== {host} ===")
        try:
            sitemap = get(f"https://{host}/sitemap.xml")
        except Exception as e:
            print(f"FAIL {host}: sitemap недоступен ({e})")
            fail = 1
            continue
        urls = re.findall(r"<loc>([^<]+)</loc>", sitemap)
        if not urls:
            print(f"FAIL {host}: sitemap без URL")
            fail = 1

        for url in urls:
            try:
                html = get(url)
            except Exception as e:
                print(f"FAIL {url}: страница недоступна ({e})")
                fail = 1
                continue
            parsed, bad, products = 0, [], []
            for b in blocks(html):
                try:
                    data = json.loads(b)
                except Exception as e:
                    bad.append(str(e)[:60])
                    continue
                parsed += 1
                walk_products(data, products)
            path = url.replace(f"https://{host}", "") or "/"
            if bad:
                print(f"FAIL {path}: битый JSON-LD — {bad}")
                fail = 1
            if not parsed:
                # легальные страницы (privacy) размечены без JSON-LD — это не ошибка
                print(f"WARN {path}: нет блоков application/ld+json (допустимо для правовых страниц)")
                continue
            for p in products:
                missing = [k for k in ("offers", "review", "aggregateRating") if not p.get(k)]
                if len(missing) == 3:
                    print(f"FAIL {path}: Product без offers/review/aggregateRating — {p.get('name')}")
                    fail = 1
            print(f"OK   {path}: блоков {parsed}, Product {len(products)}")

        for ai in ("ai/service.json", "ai/summary.json", "ai/faq.json"):
            try:
                data = json.loads(get(f"https://{host}/{ai}"))
            except Exception as e:
                print(f"FAIL {host}/{ai}: не парсится ({e})")
                fail = 1
                continue
            prods = []
            walk_products(data, prods)
            bad = [p for p in prods if not any(p.get(k) for k in ("offers", "review", "aggregateRating"))]
            if bad:
                print(f"FAIL {host}/{ai}: Product без offers/review ({len(bad)})")
                fail = 1
            else:
                print(f"OK   {host}/{ai}: парсится, Product без offers {len(bad)}")
    return fail


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["indagor.ru", "indagor.online"]))
