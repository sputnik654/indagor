// build.mjs — подготовка каталога публикации для Cloudflare Pages.
// Репозиторий остаётся корнем сайта для GitHub Pages; здесь собирается чистый dist/,
// из которого убраны служебные файлы: аналитика Netlify, package.json, отчёты, CNAME.
// Запуск: node build.mjs   ->   dist/

import { cp, rm, mkdir, readdir, stat, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SRC = process.cwd();
const OUT = path.join(SRC, "dist");

// Исключения на уровне корня и на любой глубине
const EXCLUDE_ANY = new Set([
  ".git", "node_modules", "dist", ".wrangler",
  "netlify", "netlify-public", "netlify.toml", "package.json", "package-lock.json",
  "CNAME", ".nojekyll", ".gitignore", "build.mjs", "wrangler.toml",
]);
const EXCLUDE_EXT = new Set([".md"]);

async function walk(dir, rel = "") {
  const ents = await readdir(dir, { withFileTypes: true });
  for (const e of ents) {
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (EXCLUDE_ANY.has(e.name) || EXCLUDE_EXT.has(path.extname(e.name).toLowerCase())) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(abs, relPath);
      continue;
    }
    if (!e.isFile()) continue;
    const dest = path.join(OUT, relPath);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(abs, dest);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await walk(SRC);

// _redirects и _headers обязаны лежать в корне публикуемого каталога
for (const f of ["_redirects", "_headers"]) {
  if (existsSync(path.join(SRC, f))) {
    await copyFile(path.join(SRC, f), path.join(OUT, f));
    console.log(`скопирован ${f} -> dist/${f}`);
  } else {
    console.warn(`ВНИМАНИЕ: ${f} не найден в корне, dist будет без него`);
  }
}

// Контроль: в dist не должно быть ничего из служебного
let files = 0, bytes = 0;
async function count(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await count(p);
    else { files++; bytes += (await stat(p)).size; }
  }
}
await count(OUT);
console.log(`dist: ${files} файлов, ${(bytes / 1048576).toFixed(2)} МБ`);
