/**
 * www → apex, 301. Стандарт склейки сигналов: оба сайта живут на Cloudflare Pages,
 * где www и apex — отдельные кастомные домены, поэтому редирект делается здесь,
 * а не в зоне: у API-токена нет прав на Rules/Page Rules.
 *
 * Замена без Functions (позже, если понадобится экономить вызовы):
 * зона → Rules → Redirect Rules: (http.host wildcard "www.*") → dynamic redirect
 * concat("https://", substring(http.host, 4), http.request.uri.path), статус 301.
 */
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname.startsWith("www.")) {
    const target = new URL(request.url);
    target.protocol = "https:";
    target.hostname = url.hostname.slice(4);
    return Response.redirect(target.toString(), 301);
  }
  return next();
}
