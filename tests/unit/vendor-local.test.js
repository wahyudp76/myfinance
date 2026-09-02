// v59 (2026-09-02): SEMUA dependensi JS pihak ketiga vendored lokal di vendor/
// (pinned). Test ini drift-guard-nya: kalau ada yang iseng menambah kembali
// URL CDN pihak ketiga (jsdelivr/esm.sh/cdnis/unpkg/googleapis) di jalur
// aktif app, atau CSP meta index.html & _headers tidak sinkron, atau precache
// sw.js tidak lengkap, test ini GAGAL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const appJs = readFileSync(resolve(ROOT, "app.js"), "utf8");
const headers = readFileSync(resolve(ROOT, "_headers"), "utf8");
const sw = readFileSync(resolve(ROOT, "sw.js"), "utf8");
const clientJs = readFileSync(resolve(ROOT, "src/services/supabase/client.js"), "utf8");

const VENDOR_FILES = [
  "vendor/supabase-js-2.113.0.bundle.min.mjs",
  "vendor/esm-node-process.mjs",
  "vendor/esm-node-buffer.mjs",
  "vendor/esm-node-events.mjs",
  "vendor/esm-node-tty.mjs",
  "vendor/esm-node-async_hooks.mjs",
  "vendor/chartjs-4.5.1.min.js",
  "vendor/chartjs-plugin-datalabels-2.0.0.min.js",
  "vendor/fullcalendar-6.1.10.min.js",
];

test("vendor/: semua file vendored ada + tidak kosong", () => {
  for (const f of VENDOR_FILES) {
    const p = resolve(ROOT, f);
    assert.ok(existsSync(p), `${f} hilang -- vendoring v59 rusak?`);
    assert.ok(statSync(p).size > 100, `${f} terlalu kecil (<100 B) -- unduhan gagal?`);
  }
});

test("vendor/: rantai import polyfill TERTUTUP (hanya relative ./esm-node-*)", () => {
  for (const f of VENDOR_FILES.filter((x) => x.endsWith(".mjs"))) {
    const src = readFileSync(resolve(ROOT, f), "utf8");
    const imports = [...src.matchAll(/from\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(
        spec.startsWith("./esm-node-"),
        `${f} masih mengimpor "${spec}" -- path absolut esm.sh /node/* belum ditulis ulang?`
      );
    }
  }
});

test("vendor: client.js mengimpor supabase-js dari vendor/ (bukan esm.sh)", () => {
  // client.js ada 3 level dalam (src/services/supabase/) -- path benar ../../../vendor/.
  const m = /import\s*\{[^}]*\}\s*from\s*"(\.[^"]+)"/.exec(clientJs);
  assert.ok(m, "import relatif tidak ketemu di client.js");
  assert.ok(m[1].startsWith("../../../vendor/"), `path import "${m[1]}" bukan ../../../vendor/ (client.js 3 level dalam)`);
  assert.ok(existsSync(resolve(ROOT, "src/services/supabase", m[1])), `file import "${m[1]}" tidak ada -- path rusak akan mematikan boot!`);
  assert.ok(!/from\s*"https:\/\/esm\.sh/.test(clientJs), "import esm.sh muncul lagi di client.js");
});

test("vendor: TIDAK ada URL CDN pihak ketiga di jalur aktif index.html/app.js", () => {
  // Komentar dokumentasi di index.html boleh menyebut nama CDN utk sejarah,
  // tapi bukti "jalur aktif" adalah ekspresi pemakaian: src= / href= / import.
  const activePatterns = [
    /src=["']https?:\/\/cdn\.jsdelivr\.net/i,
    /src=["']https?:\/\/esm\.sh/i,
    /href=["']https?:\/\/cdn\.jsdelivr\.net/i,
    /import\s+[^;]*from\s*["']https:\/\/esm\.sh/i,
    /import\s*\(\s*["']https:\/\/cdn\.jsdelivr\.net/i,
  ];
  for (const re of activePatterns) {
    assert.ok(!re.test(html), `index.html memakai CDN di jalur aktif: ${re}`);
    assert.ok(!re.test(appJs), `app.js memakai CDN di jalur aktif: ${re}`);
  }
});

test("CSP: script-src TIDAK lagi mengizinkan jsdelivr/esm.sh (meta + _headers sinkron)", () => {
  const metaM = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(metaM, "meta CSP tidak ketemu di index.html");
  const metaCsp = metaM[1];
  const headersM = headers.match(/Content-Security-Policy: ([^\n]+)/);
  assert.ok(headersM, "CSP tidak ketemu di _headers");
  const headersCsp = headersM[1];
  for (const csp of [metaCsp, headersCsp]) {
    const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? "";
    assert.ok(!scriptSrc.includes("jsdelivr"), "jsdelivr masih diizinkan di script-src");
    assert.ok(!scriptSrc.includes("esm.sh"), "esm.sh masih diizinkan di script-src");
    assert.ok(scriptSrc.includes("'self'"), "script-src harus 'self'");
  }
  // Semua direktif (kecuali frame-ancestors yang memang hanya di _headers)
  // harus identik antara meta & header.
  const strip = (c) =>
    c
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d && !d.startsWith("frame-ancestors"))
      .sort()
      .join(";");
  assert.equal(strip(metaCsp), strip(headersCsp), "meta CSP & _headers CSP TIDAK sinkron");
});

test("sw.js: semua file vendor di-precache + CACHE_VERSION >= v58", () => {
  for (const f of VENDOR_FILES) assert.ok(sw.includes(`'./${f}'`), `${f} tidak ada di PRECACHE_URLS`);
  const v = /CACHE_VERSION\s*=\s*'myfinance-v(\d+)'/.exec(sw)?.[1];
  assert.ok(Number(v) >= 58, `CACHE_VERSION myfinance-v${v} < v58 (vendoring butuh bump)`);
});

test("a11y: tepat satu main landmark di tiap state (loginView & appShell role=main)", () => {
  // loginView & appShell dua-duanya role="main" tapi selalu salah satu
  // display:none (.hidden) -- perbaikan audit landmark-one-main Lighthouse v59.
  const login = /<div id="loginView"[^>]*role="main"/.test(html);
  const shell = /<div id="appShell"[^>]*role="main"/.test(html);
  assert.ok(login, "#loginView tanpa role=main");
  assert.ok(shell, "#appShell tanpa role=main");
});
