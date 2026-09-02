// Gerbang sintaks utk blok <script> inline di index.html + app.js (v54:
// blok klasik monolit dipindah byte-exact dari index.html ke app.js).
// Latar belakang: sebelumnya ~440 ribu karakter JS app hidup inline di monolith
// dan TIDAK dilint/di-check otomatis di mana pun; regresi kelas c57dc6d
// (identifier salah tulis di inline script) hanya tertangkal kalau bloknya
// divalidasi sintaks per commit. Masking komentar HTML dulu supaya regex
// <script> tidak cocok dengan blok yang dikomentarkan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "../..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

// Ganti komentar HTML dgn placeholder sepanjang aslinya (posisi baris terjaga).
const masked = html.replace(/<!--[\s\S]*?-->/g, (m) => "\x00".repeat(m.length));

const blocks = [...masked.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .map((m) => ({ attrs: m[1], body: m[2] }))
  .filter((b) => b.attrs.includes("module") || b.body.split("\n").length > 21);

test("index.html memuat blok script app yang diharapkan (module + referensi app.js)", () => {
  // Guard ekstraksi: kalau regex/masker sampai rusak karena perubahan HTML,
  // test ini GAGAL loudly (bukan diam-diam nol test) supaya langsung ketahuan.
  assert.ok(blocks.length >= 1, `blok script app terdeteksi: ${blocks.length}, harusnya >= 1`);
  assert.ok(blocks.some((b) => b.attrs.includes("module")), "blok type=module harus ada");
  // Kontrak v54: blok klasik monolit hidup di app.js (bukan lagi inline).
  assert.ok(/<script src="app\.js"><\/script>/.test(html), "index.html harus mereferensikan app.js");
  // Blok inline besar tidak boleh "kembali mengintip" di index.html.
  const bigInline = blocks.filter((b) => !b.attrs.includes("module") && b.body.length > 30000);
  assert.deepEqual(bigInline, [], "blok inline > 30KB tidak boleh ada di index.html (harus di app.js)");
});

for (const [i, block] of blocks.entries()) {
  const kind = block.attrs.includes("module") ? "module" : "classic";
  test(`index.html blok script #${i} (${kind}) lolos node --check`, () => {
    const dir = mkdtempSync(join(tmpdir(), "myfinance-inline-check-"));
    // .mjs utk blok module (di-parse sbg ESM: import/export/TLA legal);
    // .js utk blok classic (tmp tanpa package.json -> parse sloppy pedekatan).
    const file = join(dir, `block${i}.${kind === "module" ? "mjs" : "js"}`);
    writeFileSync(file, block.body);
    try {
      const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(res.status, 0, `Syntax error di blok script ${kind}:\n${res.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("app.js: ada, diparse sebagai CLASSIC script (tmp tanpa package.json), sentinel fungsi utuh", () => {
  const appPath = join(ROOT, "app.js");
  assert.ok(existsSync(appPath), "app.js harus ada di root repo");
  const src = readFileSync(appPath, "utf8");
  const srcSrc = readFileSync(join(ROOT, "app.src.js"), "utf8");
  assert.ok(src.length > 150_000, `app.js terlalu kecil (${src.length} B) -- curiga salah ekstrak`);
  assert.ok(src.length < srcSrc.length, "app.js (build) harus lebih kecil dari app.src.js (sumber)");
  // Sentinel: fungsi-fungsi yang dipanggil dari onclick= di HTML & harness E2E.
  // v55: app.js adalah OUTPUT BUILD (terser) -- spasi `function foo ()` dikompaksi
  // jadi `function foo(){`, jadi pencarian memakai regex toleran-spasi. Nama
  // fungsi global TIDAK di-mangle (build-app.mjs: toplevel=false + keep_fnames)
  // dan dijaga tests/unit/app-minify.test.js.
  for (const fn of [
    "submitForm", "openModal", "loadData", "switchView",
    "hapusData", "processDataForUI", "refreshTransactionsOnly", "applyLocalTxEcho",
  ]) {
    const re = new RegExp(`function\\s+${fn}\\s*\\(`);
    assert.ok(re.test(src), `app.js kehilangan sentinel: function ${fn}(`);
  }
  // Parse ulang di direktori TANPA package.json -> Node memperlakukan .js sebagai
  // CommonJS/sloppy (pendekatan terdekat dengan classic script di browser).
  const dir = mkdtempSync(join(tmpdir(), "myfinance-appjs-check-"));
  const file = join(dir, "app.js");
  writeFileSync(file, src);
  try {
    const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(res.status, 0, `app.js tidak lolos parse classic:\n${res.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
