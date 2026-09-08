/**
 * Build boot.bundle.js (bundel ESM) dari boot.js + seluruh modul src/ yang
 * diimpornya -- pola yang sama dengan app.src.js -> app.js (v54) dan
 * styles.src.css -> styles.css (v53): hasil build DI-COMMIT, sumbernya tetap
 * satu-satunya yang diedit manual, dan drift dijaga unit test + job CI.
 *
 * MASALAH YANG DISELESAIKAN (audit perawatan v100):
 * kunjungan PERTAMA menembak 101 request, karena boot.js mengimpor 71 modul
 * ESM yang masing-masing jadi satu request (rata-rata cuma ~2,2 KB gzip).
 * Setelah service worker aktif hal ini tidak terasa lagi, tapi pengunjung
 * pertama di jaringan seluler membayar 71 round-trip berurutan mengikuti
 * rantai impor -- biaya latensi, bukan biaya byte.
 *
 * KENAPA AMAN:
 * - Tidak ada satu pun `import()` dinamis maupun `import.meta` di boot.js/src/
 *   (diperiksa sebelum bundling diputuskan), jadi tidak ada modul yang
 *   identitas atau URL-nya dipakai saat runtime.
 * - vendor/ sengaja DIBIARKAN EXTERNAL: supabase-js sudah berupa bundel
 *   ter-pin sendiri, dan polyfill esm-node-* diimpor oleh bundel itu, bukan
 *   oleh kode kita. Menariknya masuk hanya akan menggandakan pekerjaan yang
 *   sudah dilakukan penerbitnya, dan mempersulit audit provenance vendor.
 * - format ESM + `<script type="module">` dipertahankan, jadi semantik eksekusi
 *   (defer, strict mode, scope modul) sama persis seperti sebelumnya.
 *
 * Jalankan: npm run build:boot
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "boot.js");
const OUT = resolve(ROOT, "boot.bundle.js");

const BANNER =
  "/*! MyFinance -- boot.bundle.js (BUILD OUTPUT, jangan edit manual)\n" +
  " * SUMBER: boot.js + modul src/ yang diimpornya (itu yang diedit manual).\n" +
  " * Build : npm run build:boot (esbuild -- bundle ESM, vendor/ tetap external).\n" +
  " * Drift : tests/unit/boot-bundle.test.js + job CI css-drift.\n" +
  " */\n";

// vendor/ tetap jadi request terpisah. Path impornya ditulis relatif terhadap
// berkas sumber ('../../../vendor/...'), sedangkan bundel hasil ada di ROOT --
// jadi path itu HARUS ditulis ulang jadi './vendor/...', kalau tidak bundel
// akan meminta berkas di atas root situs.
const vendorExternal = {
  name: "vendor-external",
  setup(b) {
    b.onResolve({ filter: /(^|\/)vendor\// }, (args) => ({
      path: `./vendor/${args.path.split("/vendor/").pop()}`,
      external: true,
    }));
  },
};

const result = await build({
  entryPoints: [SRC],
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

const keluaran = result.outputFiles[0].text;
if (!keluaran) {
  console.error("esbuild tidak menghasilkan output.");
  process.exit(1);
}
writeFileSync(OUT, BANNER + keluaran);

const srcBytes = Buffer.byteLength(readFileSync(SRC, "utf8"));
const outBytes = Buffer.byteLength(BANNER + keluaran);
console.log(`boot.js ${srcBytes} B + modul src/ -> boot.bundle.js ${outBytes} B`);
