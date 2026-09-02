// Helper bersama: hitung hash aset lokal yang di-serve service worker.
// Dipakai update-sw-cache-snapshot.mjs (tulis) & sw-cache-version.test.js (cek).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// v55: app.js ditambahkan ke hash -- dia precache asset utama (PRECACHE_URLS)
// dan justru paling sering berubah. Tanpa ini, perubahan app.js saja tidak
// pernah memicu kewajiban bump CACHE_VERSION.
// v59: vendor/ ditambahkan ke DIRS -- seluruh pustaka pihak ketiga kini
// lokal + di-precache; perubahan file vendor WAJIB memicu bump CACHE_VERSION.
const TOP_FILES = ["index.html", "app.js", "styles.css", "manifest.json"];
const DIRS = ["src", "vendor", "icons", "css", "fonts", "webfonts"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export async function computeSwAssetHash() {
  const sw = readFileSync("sw.js", "utf8");
  const m = sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error("CACHE_VERSION tidak ketemu di sw.js");
  const version = m[1];

  const files = [...TOP_FILES, ...DIRS.flatMap((d) => walk(d))].sort();
  const h = createHash("sha256");
  h.update("version:" + version + "\n");
  for (const f of files) {
    h.update("file:" + f + "\n");
    h.update(readFileSync(f));
  }
  return { version, hash: h.digest("hex"), fileCount: files.length };
}
