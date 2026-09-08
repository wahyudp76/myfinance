// GUARD boot.bundle.js (v103) -- pola sama dengan app-minify.test.js &
// styles-minify.test.js: hasil build DI-COMMIT, jadi ia bisa basi diam-diam.
//
// Kenapa berbahaya kalau tidak dijaga: boot.bundle.js adalah SATU-SATUNYA
// wiring yang benar-benar dieksekusi browser sekarang. Kalau seseorang mengedit
// boot.js atau modul src/ lalu lupa `npm run build:boot`, semua unit test tetap
// hijau (mereka mengimpor sumbernya langsung) dan lint tetap hijau -- tapi yang
// TAYANG masih versi lama. Kegagalan diam-diam yang paling mahal.
//
// CATATAN job CI "unit" berjalan TANPA npm ci (hanya Node builtin) -- saat
// esbuild tidak terpasang, test drift di-SKIP dengan pesan jelas; pengawasan
// drift SESUNGGUHNYA dijaga job css-drift (yang npm ci lalu build + git diff).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const SUMBER = resolve(ROOT, "boot.js");
const BUNDEL = resolve(ROOT, "boot.bundle.js");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const sw = readFileSync(resolve(ROOT, "sw.js"), "utf8");

let esbuild = null;
try {
  esbuild = await import("esbuild");
} catch {
  esbuild = null;
}

function precacheUrls() {
  const awal = sw.indexOf("const PRECACHE_URLS = [");
  assert.notEqual(awal, -1, "PRECACHE_URLS harus ada di sw.js");
  const blok = sw.slice(awal, sw.indexOf("];", awal));
  return [...blok.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]);
}

test("index.html memuat boot.bundle.js sebagai module, BUKAN boot.js", () => {
  assert.match(html, /<script type="module" src="\.\/boot\.bundle\.js"><\/script>/);
  assert.ok(
    !/<script[^>]*src="\.\/boot\.js"/.test(html),
    "boot.js tidak boleh lagi dimuat langsung -- ia sumber, bukan artefak kirim"
  );
});

test("boot.bundle.js ada di PRECACHE_URLS", () => {
  assert.ok(precacheUrls().includes("./boot.bundle.js"), "bundel wajib di-precache");
});

test("modul src/ TIDAK lagi di-precache (sudah masuk bundel)", () => {
  // Sisa entri src/ berarti service worker mengunduh berkas yang tidak pernah
  // diminta browser -- 67 fetch sia-sia tiap install, persis biaya yang
  // dihapus v103.
  const sisa = precacheUrls().filter((u) => u.startsWith("./src/"));
  assert.deepEqual(sisa, [], `masih ada modul src/ di precache: ${sisa.slice(0, 5).join(", ")}`);
});

test("jumlah entri precache turun drastis (bukti bundling benar-benar terpasang)", () => {
  const n = precacheUrls().length;
  assert.ok(n < 45, `entri precache ${n}, harusnya jauh di bawah 98 seperti sebelum bundling`);
});

test("boot.bundle.js diawali banner build & jauh lebih besar dari boot.js", () => {
  const bundel = readFileSync(BUNDEL, "utf8");
  const sumber = readFileSync(SUMBER, "utf8");
  assert.ok(bundel.startsWith("/*!"), "harus diawali banner build output");
  assert.ok(bundel.includes("jangan edit manual"), "banner harus memperingatkan agar tidak diedit manual");
  assert.ok(bundel.length > sumber.length * 3,
    `bundel (${bundel.length}) harus jauh lebih besar dari boot.js (${sumber.length}) -- ia memuat modul src/`);
});

test("vendor/ TETAP external (tidak ikut dibundel)", () => {
  const bundel = readFileSync(BUNDEL, "utf8");
  assert.match(bundel, /from\s*["']\.\/vendor\/supabase-js-2\.113\.0\.bundle\.min\.mjs["']/,
    "impor supabase-js harus tetap berupa impor eksternal ke ./vendor/");
  // Path relatif sumber ('../../../vendor/...') TIDAK boleh bocor ke bundel di root.
  assert.ok(!/\.\.\/\.\.\/\.\.\/vendor\//.test(bundel),
    "path relatif sumber bocor ke bundel -- akan meminta berkas di atas root situs");
});

test("bundel tidak menyisakan impor modul lokal (semuanya sudah inline)", () => {
  const bundel = readFileSync(BUNDEL, "utf8");
  const impor = [...bundel.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const lokal = impor.filter((u) => !u.startsWith("./vendor/"));
  assert.deepEqual(lokal, [], `masih ada impor non-vendor: ${lokal.join(", ")}`);
});

test(
  "boot.bundle.js = hasil build boot.js (drift guard)",
  { skip: esbuild ? false : "esbuild tidak terpasang (job CI 'unit' memang tanpa install) -- drift dijaga job css-drift" },
  async () => {
    const skrip = readFileSync(resolve(ROOT, "scripts/build-boot.mjs"), "utf8");
    // Bangun ulang memakai opsi yang PERSIS sama seperti skrip build.
    const vendorExternal = {
      name: "vendor-external",
      setup(b) {
        b.onResolve({ filter: /(^|\/)vendor\// }, (args) => ({
          path: `./vendor/${args.path.split("/vendor/").pop()}`,
          external: true,
        }));
      },
    };
    const hasil = await esbuild.build({
      entryPoints: [SUMBER],
      bundle: true,
      format: "esm",
      target: "es2020",
      platform: "browser",
      minify: true,
      legalComments: "none",
      write: false,
      plugins: [vendorExternal],
      absWorkingDir: ROOT,
    });
    const bannerBlock = skrip.match(/const BANNER =\s*([\s\S]*?);\n/);
    assert.ok(bannerBlock, "banner build script tidak ketemu");
    const bannerText = [...bannerBlock[1].matchAll(/"([^"]*)"/g)]
      .map((m) => m[1])
      .join("")
      .replace(/\\n/g, "\n");
    assert.equal(
      readFileSync(BUNDEL, "utf8"),
      bannerText + hasil.outputFiles[0].text,
      "boot.bundle.js tidak sinkron dengan boot.js/src. Jalankan: npm run build:boot, lalu commit hasilnya."
    );
  }
);
