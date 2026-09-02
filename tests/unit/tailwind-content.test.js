// Guard kontrak build Tailwind (pelajaran v54): kalau app.js tidak didaftarkan
// di tailwind.config.js content, rebuild css/tailwind.css akan MEMBUANG kelas
// yang dipakai app (blok monolit yang dipindah dari index.html ke app.js) --
// persis penyebab job css-drift gagal pada push pertama v54.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

test("tailwind.config.js content memuat app.js AND index.html (sumber kelas monolit)", () => {
  const cfg = readFileSync(resolve(ROOT, "tailwind.config.js"), "utf8");
  assert.match(cfg, /app\.js/, "content harus memuat app.js (blok monolit yang dipindah dari index.html, v54)");
  assert.match(cfg, /index\.html/, "content harus memuat index.html");
});

test("app.js direferensikan di index.html (kontrak ekstraksi v54 dipertahankan)", () => {
  const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
  assert.match(html, /<script src="app\.js"><\/script>/, "index.html harus mereferensikan app.js");
});
