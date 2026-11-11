#!/usr/bin/env bash
# IndexNow — мгновенное уведомление поисковиков (Bing, Яндекс, Seznam и др.)
# об изменении страниц. Протокол: https://www.indexnow.org/documentation
#
# Использование:
#   ./indexnow-ping.sh                                  # отправить главную и Клондайк
#   ./indexnow-ping.sh https://indagor.ru/ https://indagor.ru/klondayk/
#
# Ключ лежит в файле 0cfa9c5716e44e47bc869ab3ab4d66a9.txt в корне сайта.
# Поисковик сам проверит его по адресу https://indagor.ru/<ключ>.txt

set -euo pipefail

KEY="0cfa9c5716e44e47bc869ab3ab4d66a9"
HOST="indagor.ru"

if [ "$#" -gt 0 ]; then
  URLS=("$@")
else
  URLS=("https://indagor.ru/" "https://indagor.ru/klondayk/")
fi

LIST=$(printf '"%s",' "${URLS[@]}")
LIST="[${LIST%,}]"

echo "Отправляю в IndexNow: ${#URLS[@]} URL(ов)"
for u in "${URLS[@]}"; do echo "  · $u"; done

RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"${HOST}\",\"key\":\"${KEY}\",\"keyLocation\":\"https://${HOST}/${KEY}.txt\",\"urlList\":${LIST}}")

case "$RESP" in
  200) echo "✔ 200 — принято" ;;
  202) echo "✔ 202 — принято, ключ проверяется" ;;
  400) echo "✘ 400 — неверный формат запроса" ;;
  403) echo "✘ 403 — ключ не найден или не совпадает (проверьте https://${HOST}/${KEY}.txt)" ;;
  422) echo "✘ 422 — URL не принадлежат указанному host" ;;
  429) echo "✘ 429 — слишком много запросов, повторите позже" ;;
  *)   echo "✘ Неожиданный код ответа: $RESP" ;;
esac
