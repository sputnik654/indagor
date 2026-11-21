# Аналитика INDAGOR без Метрики и Google Analytics

Собственный счётчик посещений `indagor.ru`: сайт остаётся на GitHub Pages, а приём и чтение
статистики делает бесплатный Netlify (функции + встроенное хранилище Blobs). Банковская карта
не нужна, сторонних трекеров и cookie в этом контуре нет.

```
посетитель ──► assets/analytics-tracker.js ──► POST /track ──► Netlify Blobs
(после «Принять»)      (анонимно)              (функция)        events/YYYY-MM-DD.json
                                                                      │
                                    scripts/fetch_stats.py ◄── GET /stats (токен)
```

| Файл | Назначение |
|---|---|
| `netlify.toml` | publish — пустой `netlify-public/`, functions — `netlify/functions`, сборка esbuild |
| `package.json` | `type: module` + `@netlify/blobs` (точная версия) |
| `netlify/functions/track.js` | `POST /track`: фильтр ботов (60+ шаблонов) и DNT, анонимные поля, запись в Blobs |
| `netlify/functions/stats.js` | `GET /stats`: агрегаты по токену `x-auth-token` |
| `assets/analytics-tracker.js` | клиентский скрипт на 12 страницах (3,9 КБ, без библиотек) |
| `scripts/fetch_stats.py` | отчёт в Markdown: топ-страницы, источники, динамика, устройства |
| `netlify-public/.gitkeep` | заглушка publish-каталога, чтобы Netlify не падал |

## Что собирается

Хранилище: Netlify Blobs, store `analytics`, ключ `events/YYYY-MM-DD.json` (день по Москве),
массив событий, лимит 10 000 в сутки. Три типа событий (`ty`):

| `ty` | Что это | Когда отправляется |
|---|---|---|
| `pv` | просмотр страницы | всегда, независимо от согласия |
| `cg` | «Принять» в cookie-баннере | по клику; несёт `session_id` |
| `dr` | время на странице (`dur`, сек) | закрытие активного отрезка: уход со вкладки (`visibilitychange → hidden`) или `pagehide` |

Время считается **только активное**: таймер идёт при `document.visibilityState === 'visible'`
и встаёт на паузу, когда вкладка скрыта. Каждый активный отрезок уходит отдельным `dr`
(минимум 2 с, не больше 20 отрезков на страницу), поэтому `avg_duration_sec` — средняя
длительность активного отрезка, а сумма всех `dr` — чистое время на странице. Фоновое
«висение» в открытой вкладке в цифры не попадает.

```json
{"t":1763200000000,"ty":"pv","c":0,"p":"/klondayk/","r":"google.com","d":"mobile","l":"ru-ru","w":390}
{"t":1763200005000,"ty":"cg","c":1,"p":"/klondayk/","d":"desktop","l":"ru-ru","w":1280,"sid":"a1b2c3d4e5f60718"}
```

- `t` — время (мс), `p` — путь, `r` — домен источника (пусто = прямой заход),
  `d` — mobile/tablet/desktop, `l` — язык, `w` — ширина окна,
  `c` — согласие (1/0), `sid` — 16-символьный идентификатор вкладки (только при `c:1`),
  `dur` — секунды на странице, `u_src`/`u_med`/`u_cmp` — UTM.
- **Без согласия** уходит только `pv` без `session_id`, без cookie и IP: просмотры нельзя
  связать между собой, считаются лишь суммы по страницам/источникам/устройствам.
- **С согласием** добавляются `cg` и `dr` с `sid`, а `analytics.js` грузит Метрику и GTM/GA4.
- Сервер принудительно отбрасывает `session_id` у событий с `consent: false` — даже если
  клиент его пришлёт.
- Не сохраняются: IP-адрес, полный User-Agent, cookie, содержимое страниц.
- Запись идёт с оптимистичной блокировкой по ETag (`onlyIfMatch`), параллельные запросы
  не теряют события.

## Развёртывание (один раз)

1. https://app.netlify.com → **Add new site → Import an existing project** → GitHub →
   `sputnik654/indagor`. Build command — пустой, publish `netlify-public`,
   functions `netlify/functions` (берутся из `netlify.toml`).
2. **Site configuration → Environment variables** → `STATS_TOKEN` = длинная случайная строка
   (`openssl rand -hex 24`). Сохранить и нажать **Deploy site**.
3. Запомнить адрес функции: `https://bright-wisp-6c6965.netlify.app/track`.
4. Адрес функции уже прописан в `<meta name="analytics-endpoint">` на всех 12 страницах:
   `https://bright-wisp-6c6965.netlify.app/track` — это путь из
   `export const config = { path: "/track" }`. Служебный вид `/.netlify/functions/track`
   на этом деплое отдаёт 404 (проверено), поэтому в meta только короткий путь. Если сайт
   переедет на другой поддомен — заменить одной командой:

```bash
grep -rl "bright-wisp-6c6965.netlify.app" --include=*.html . \
  | xargs sed -i 's#https://bright-wisp-6c6965.netlify.app/track#https://<новый>.netlify.app/track#'
```

5. Проверить приём (бот-фильтр реагирует на User-Agent — curl отбрасывается, это норма,
   поэтому проверяем «человеческим» UA):

```bash
curl -sS -X POST https://bright-wisp-6c6965.netlify.app/track \
  -H 'Content-Type: text/plain' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0' \
  -d '{"path":"/test/","ref":"https://ya.ru","ua_type":"desktop","lang":"ru-RU","viewport":1280,"session_id":"test12345678abcd","ts":'"$(date +%s000)"'}'
# → {"ok":true}
```

6. Проверить чтение:

```bash
curl -sS "https://bright-wisp-6c6965.netlify.app/stats?from=$(date -d '-6 days' +%F)&to=$(date +%F)" \
  -H "x-auth-token: $STATS_TOKEN"
```

## Отчёт

```bash
# переменные берутся из окружения; локально они лежат в файле с правами 600
set -a; . ~/.hermes/.env; set +a

python3 scripts/fetch_stats.py              # последние 7 дней, Markdown
python3 scripts/fetch_stats.py --days 30
python3 scripts/fetch_stats.py --from 2026-11-01 --to 2026-11-15
python3 scripts/fetch_stats.py --json       # сырой JSON
```

В ответе `/stats`: `total` (все просмотры), `total_anonymous` / `total_consented`
(разделение по согласию), `anonymous_share` (%), `consents` (сколько раз нажали «Принять»),
`sessions` (уникальные вкладки — только с согласием), `avg_duration_sec` + `duration_samples`
(средняя длительность активного отрезка на странице; сумма отрезков = активное время), `by_page`, `by_ref`, `by_day`, `by_device`, `by_lang`,
`by_hour`, `by_utm_source`.

## Ограничения и оговорки

- Free tier: 125 000 вызовов функций и 1 ГБ Blobs в месяц — при текущем трафике запас в десятки раз.
- Blobs хранятся в регионе `us-east-2` (США). Данные обезличенные, но это трансграничная
  передача; факт раскрыт в `privacy.html` (раздел 5).
- Боты отсекаются по User-Agent, IP не проверяется: самопровозглашённый UA бота пройдёт,
  аккуратный парсер под видом Chrome — тоже. Для понимания аудитории этого достаточно,
  для биллинга — нет.
- Honeypot против спама — только суточный лимит в 10 000 событий.
- `netlify.toml`, `package.json`, `netlify/` и `scripts/` попадают в публикацию GitHub Pages;
  секретов в них нет, в `robots.txt` служебные пути закрыты от индексации.
