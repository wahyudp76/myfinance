// PENGUJIAN DRIFT styles.css (pola sama seperti sw-cache-version.test.js):
// styles.css harus selalu SAMA dengan hasil build `npm run build:styles`
// dari styles.src.css. Kalau styles.src.css diedit tanpa build, test ini
// GAGAL dengan perintah pembetulnya -- supaya tidak ada "CSS editor manual"
// yang jadi sumber regresi diam-diam.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import CleanCSS from "clean-css";

const ROOT = resolve(import.meta.dirname, "../..");
const SRC = resolve(ROOT, "styles.src.css");
const OUT = resolve(ROOT, "styles.css");

function buildMinified() {
  const source = readFileSync(SRC, "utf8");
  const result = new CleanCSS({ level: 1 }).minify(source);
  assert.equal(result.errors.length, 0, `clean-css error: ${result.errors.join("; ")}`);
  return result.styles;
}

test("styles.css = hasil minify styles.src.css (drift guard)", () => {
  const committed = readFileSync(OUT, "utf8");
  const built = buildMinified();
  assert.equal(
    built,
    committed,
    "styles.css tidak sinkron dengan styles.src.css. Jalankan: npm run build:styles, lalu commit styles.css + styles.src.css."
  );
});

test("build styles berisi banner /*! (tanda build output) dan styles.src berisi komentar sumber", () => {
  const out = readFileSync(OUT, "utf8");
  const src = readFileSync(SRC, "utf8");
  assert.ok(out.startsWith("/*!"), "styles.css harus dimulai dengan banner /*! (build output)");
  assert.ok(/jangan edit manual/.test(src), "styles.src.css harus memuat peringatan sumber");
});
