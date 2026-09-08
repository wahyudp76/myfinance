/**
 * Build CSP script-src hash untuk index.html (v104).
 *
 * MASALAH: `script-src 'self' 'unsafe-inline'` membuat gerbang CSP nyaris tidak
 * berarti untuk skrip -- browser akan menjalankan SETIAP skrip inline yang
 * berhasil disisipkan penyerang. Ia dulu wajib ada karena index.html memuat
 * atribut onclick= dan blok <script> inline. Atribut handler sudah habis di
 * Fase 4 (v101-v102); yang tersisa 4 blok <script> inline.
 *
 * KENAPA HASH, BUKAN DIEKSTRAK JADI BERKAS:
 * blok pertama menetapkan tema SEBELUM render (anti kedip terang/gelap). Kalau
 * dijadikan berkas eksternal ia menjadi request PEMBLOKIR sebelum paint --
 * menambah satu round-trip penuh di jaringan seluler, persis biaya yang baru
 * dihapus v103. Hash membuat blok inline tetap boleh jalan TANPA membuka pintu
 * bagi skrip inline lain, dan tanpa request tambahan sama sekali.
 *
 * Skrip yang DIBUAT runtime (Chart.js, FullCalendar) memakai .src ke berkas
 * lokal, jadi tetap lolos lewat 'self' -- bukan skrip inline.
 *
 * Hasilnya ditulis balik ke index.html (idempoten) dan drift-nya dijaga
 * tests/unit/csp-hash.test.js + job CI css-drift.
 *
 * Jalankan: npm run build:csp
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const FILE = resolve(ROOT, "index.html");
// CSP juga dikirim sebagai HEADER untuk host yang mendukungnya (_headers).
// Keduanya WAJIB sinkron -- sudah dijaga tests/unit/vendor-local.test.js, dan
// guard itulah yang menangkap kelalaian saat v104 pertama kali dibuat.
const HEADERS = resolve(ROOT, "_headers");

/**
 * Kumpulkan hash sha256 (base64) dari SETIAP blok <script> tanpa atribut src.
 * Hash dihitung atas teks PERSIS di antara tag pembuka dan penutup -- itulah
 * yang di-hash browser, termasuk spasi & baris barunya.
 * @param {string} html
 * @returns {string[]} daftar token CSP, mis. "'sha256-abc...='"
 */
export function hitungHashSkripInline(html) {
  const hashes = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\ssrc\s*=/.test(m[1])) continue; // skrip eksternal: dijamin oleh 'self'
    const digest = createHash("sha256").update(m[2], "utf8").digest("base64");
    const token = `'sha256-${digest}'`;
    if (!hashes.includes(token)) hashes.push(token);
  }
  return hashes;
}

/**
 * Tulis ulang direktif script-src memakai daftar hash.
 * @param {string} html
 * @returns {{html: string, hashes: string[]}}
 */
export function terapkanCspScriptSrc(html) {
  const hashes = hitungHashSkripInline(html);
  if (hashes.length === 0) throw new Error("tidak ada skrip inline terdeteksi -- curiga regex rusak");
  const baru = `script-src 'self' ${hashes.join(" ")};`;
  const cocok = html.match(/script-src [^;]*;/);
  if (!cocok) throw new Error("direktif script-src tidak ketemu di index.html");
  return { html: html.replace(cocok[0], baru), hashes };
}

// Dipanggil sebagai skrip (bukan diimpor tes)
if (process.argv[1] && process.argv[1].endsWith("build-csp.mjs")) {
  const asli = readFileSync(FILE, "utf8");
  const { html, hashes } = terapkanCspScriptSrc(asli);
  let berubah = false;
  if (html !== asli) { writeFileSync(FILE, html); berubah = true; }

  // _headers memakai daftar direktif yang sama; hanya script-src yang disentuh.
  // HANYA baris header sungguhan yang disentuh. Percobaan pertama v104 memakai
  // regex /script-src [^;]*;/ polos dan justru mengenai BARIS KOMENTAR di atas
  // (yang kebetulan menyebut "script-src"), merusak komentar sekaligus
  // membiarkan header aslinya tetap 'unsafe-inline'.
  const headersAsli = readFileSync(HEADERS, "utf8");
  const barisCsp = headersAsli.match(/^[ \t]*Content-Security-Policy:[^\n]*$/m);
  if (!barisCsp) throw new Error("baris Content-Security-Policy tidak ketemu di _headers");
  if (!/script-src [^;]*;/.test(barisCsp[0])) throw new Error("script-src tidak ketemu di baris CSP _headers");
  const barisBaru = barisCsp[0].replace(/script-src [^;]*;/, `script-src 'self' ${hashes.join(" ")};`);
  const headersBaru = headersAsli.replace(barisCsp[0], barisBaru);
  if (headersBaru !== headersAsli) { writeFileSync(HEADERS, headersBaru); berubah = true; }

  console.log(berubah
    ? `CSP script-src diperbarui di index.html + _headers: ${hashes.length} hash, 'unsafe-inline' dilepas.`
    : `CSP script-src sudah mutakhir di index.html + _headers (${hashes.length} hash).`);
  hashes.forEach((h, i) => console.log(`  #${i + 1} ${h}`));
}
