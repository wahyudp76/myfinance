/**
 * Build styles.css (minified) dari styles.src.css -- pola yang sama persis
 * dengan css/tailwind.css: hasil build DI-COMMIT, sumber satu-satunya yang
 * diedit manual, dan test drift (tests/unit/styles-minify.test.js) menjamin
 * build tidak pernah ketinggalan dari sumber.
 *
 * Alasan: styles.css adalah CSS manual (~50 KB, banyak komentar) yang
 * render-blocking. Minifikasi memangkas byte yang dikirim (gzip) + waktu
 * parse CSS di device lambat, TANPA mengubah satu pun rule (semantik
 * dipertahankan clean-css).
 *
 * Jalankan: npm run build:styles
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import CleanCSS from "clean-css";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "styles.src.css");
const OUT = resolve(ROOT, "styles.css");

const source = readFileSync(SRC, "utf8");
const result = new CleanCSS({ level: 1 }).minify(source);
if (result.errors && result.errors.length) {
  console.error("Gagal minify styles.src.css:");
  result.errors.forEach((e) => console.error("  " + e));
  process.exit(1);
}

writeFileSync(OUT, result.styles);
const srcBytes = Buffer.byteLength(source);
const outBytes = Buffer.byteLength(result.styles);
console.log(`styles.src.css ${srcBytes} B -> styles.css ${outBytes} B (-${((1 - outBytes / srcBytes) * 100).toFixed(1)}%)`);
