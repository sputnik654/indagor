# Собственная аналитика INDAGOR (Netlify Functions + Blobs)

Сайт остаётся на GitHub Pages (`indagor.ru`). Netlify не хостит сайт — только две функции,
которые не зависят от Метрики, GA и банковских карт (free tier).

| Файл | Что делает |
|---|---|
| `netlify.toml` | publish = пустой `netlify-public/`, functions = `netlify/functions`, esbuild |
| `netlify/functions/track.js` | `POST /track` — приём анонимных событий, фильтр ботов и DNT, запись в Blobs |
| `netlify/functions/stats.js` | `GET /stats` — агрегаты по токену `x-auth-token` |
| `assets/analytics-tracker.js` | клиентский скрипт на страницах сайта (после согласия) |

## Данные

Хранилище: Netlify Blobs, store `analytics`, ключ `events/YYYY-MM-DD.json` (день по Москве) —
массив событий, максимум 10 000 в сутки.

```json
{"t":1763200000000,"p":"/klondayk/","r":"google.com","d":"mobile","l":"ru-ru","w":390,"sid":"…","u_src":"yandex"}
```

Не сохраняются: IP-адрес, полный User-Agent, cookie, любые ПДн.
Запись идёт с оптимистичной блокировкой по ETag (`onlyIfMatch`), поэтому параллельные
запросы не теряют события.

## Разовая настройка (нужен аккаунт Netlify, карта не требуется)

1. https://app.netlify.com → **Add new site → Import an existing project** → GitHub → `sputnik654/indagor`.
   Build command оставить пустым, publish `netlify-public`, functions `netlify/functions` — берётся из `netlify.toml`.
2. **Site configuration → Environment variables** → `STATS_TOKEN` = длинная случайная строка
   (например `openssl rand -hex 24`). Сохранить и сделать **Deploy site**.
3. Проверить, что адрес сайта известен: `https://<имя>.netlify.app/track`.
4a. Если имя совпало с `indagor-analytics` — ничего менять не нужно.
4b. Если имя другое — заменить endpoint в `<meta name="analytics-endpoint">` на всех 12 страницах:

```bash
grep -rl "analytics-endpoint" --include=*.html . | xargs sed -i 's#https://[a-z0-9-]*\.netlify\.app/track#https://NEW-NAME.netlify.app/track#'
```

5. Проверка записи: открыть сайт, нажать «Принять» в cookie-баннере, затем

```bash
curl -sS -X POST https://<имя>.netlify.app/track \
  -H 'Content-Type: text/plain' \
  -d '{"path":"/test/","ref":"https://google.com","ua_type":"desktop","lang":"ru-RU","viewport":1280,"session_id":"test1234","ts":'$(date +%s000)'}'
# → {"ok":true}

curl -sS https://<имя>.netlify.app/stats -H "x-auth-token: $STATS_TOKEN"
```

## Ограничения free tier

- Functions: 125 000 вызовов и 100 часов работы в месяц — при 1–2 тыс. визитов в месяц запас огромный.
- Blobs: 1 ГБ хранения, 1 млн операций чтения/записи в месяц.
- Данные хранятся в регионе `us-east-2` (США). Персональных данных в них нет, но это стоит
  помнить при чтении политики конфиденциальности.
