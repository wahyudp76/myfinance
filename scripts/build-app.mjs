/**
 * Build app.js (minified) dari app.src.js -- pola yang sama persis dengan
 * styles.src.css -> styles.css (v53) dan css/tailwind.css: hasil build
 * DI-COMMIT, app.src.js satu-satunya file yang diedit, dan drift dijaga oleh
 * tests/unit/app-minify.test.js + job CI css-drift (git diff --exit-code).
 *
 * KENAPA AMAN (aturan terser yang dipilih):
 * - `mangle.toplevel: false` + `keep_fnames: true` -> seluruh fungsi GLOBAL
 *   dipertahankan namanya. Nama-nama itu adalah KONTRAK: dipanggil dari
 *   onclick=/onchange= di index.html dan langsung oleh harness E2E
 *   (scripts/verify-hud.mjs via page.evaluate). Guard di
 *   tests/unit/app-minify.test.js memverifikasi setiap handler HTML masih ada
 *   sebagai `function <nama>(` di output.
 * - `module: false` (default) -> diparse sbg CLASSIC script (sloppy), sama
 *   seperti cara browser memuat <script src="app.js">.
 * - `compress.passes: 2` tapi `unsafe: false` -> hanya transformasi yang
 *   dijamin semantik-identik untuk kode non-eval sejati (app ini tidak
 *   memakai eval/new Function -- sudah dibuktikan saat 'unsafe-eval' dilepas
 *   dari CSP di v46).
 *
 * Jalankan: npm run build:app
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { minify } from "terser";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "app.src.js");
const OUT = resolve(ROOT, "app.js");

const BANNER =
  "/*! MyFinance -- app.js (BUILD OUTPUT, jangan edit manual)\n" +
  " * SUMBER: app.src.js (satu-satunya file yang diedit manual).\n" +
  " * Build : npm run build:app (terser -- mangle toplevel OFF, semua nama\n" +
  " *         fungsi global dipertahankan utk onclick= & harness E2E).\n" +
  " * Drift : tests/unit/app-minify.test.js + job CI css-drift.\n" +
  " */\n";

const source = readFileSync(SRC, "utf8");
const result = await minify(source, {
  ecma: 2020,
  compress: { passes: 2, unsafe: false },
  mangle: { toplevel: false, keep_fnames: true },
  format: { comments: false },
});
if (!result.code) {
  console.error("terser gagal menghasilkan output (result.code kosong).");
  process.exit(1);
}

const out = BANNER + result.code;
writeFileSync(OUT, out);
const srcBytes = Buffer.byteLength(source);
const outBytes = Buffer.byteLength(out);
console.log(`app.src.js ${srcBytes} B -> app.js ${outBytes} B (-${((1 - outBytes / srcBytes) * 100).toFixed(1)}%)`);
