// GUARD CSP script-src berbasis hash (v104).
//
// Setelah 'unsafe-inline' dilepas, index.html hanya boleh menjalankan blok
// skrip inline yang hash-nya terdaftar. Konsekuensinya: SATU SPASI yang berubah
// di dalam blok itu membuat browser menolak menjalankannya -- tanpa exception,
// tanpa error build, tanpa unit test lain yang merah. Fitur yang dijalankan
// blok itu (tema, jembatan auth, pemuat grafik, registrasi service worker)
// hilang diam-diam.
//
// Tes ini menjaga hash tetap sinkron; scripts/verify-csp.mjs menjaga sisi
// perilakunya di browser sungguhan (blok benar-benar jalan, penyisipan
// benar-benar ditolak).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hitungHashSkripInline } from "../../scripts/build-csp.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");

function scriptSrc() {
  const meta = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/);
  assert.ok(meta, "meta CSP harus ada di index.html");
  const m = meta[1].match(/script-src ([^;]*)/);
  assert.ok(m, "direktif script-src harus ada");
  return m[1];
}

test("meta CSP berada SEBELUM skrip apa pun", () => {
  // Ini bukan detail gaya. <meta> CSP hanya mengatur konten SESUDAHNYA; sampai
  // v103 blok skrip tema berada di ATAS meta dan karena itu sama sekali tidak
  // terjaga -- hash-nya bisa salah tanpa akibat apa pun. Terbukti saat uji
  // negatif: hash dirusak, browser tetap menjalankannya tanpa keluhan.
  const posMeta = html.indexOf('<meta http-equiv="Content-Security-Policy"');
  assert.notEqual(posMeta, -1);
  const posSkrip = html.search(/<script[\s>]/);
  assert.notEqual(posSkrip, -1);
  assert.ok(
    posMeta < posSkrip,
    "meta CSP harus mendahului skrip pertama, kalau tidak skrip itu berjalan di luar kebijakan"
  );
});

test("script-src TIDAK memuat 'unsafe-inline'", () => {
  assert.ok(!scriptSrc().includes("'unsafe-inline'"),
    "'unsafe-inline' membuat gerbang skrip CSP praktis tidak berarti");
});

test("script-src TIDAK memuat 'unsafe-eval'", () => {
  assert.ok(!scriptSrc().includes("'unsafe-eval'"));
});

test("script-src masih mengizinkan 'self' (skrip ber-src lokal & yang dibuat runtime)", () => {
  // Chart.js & FullCalendar dimuat dengan membuat <script src="./vendor/...">
  // saat runtime -- itu bukan skrip inline, jadi 'self' wajib tetap ada.
  assert.ok(scriptSrc().includes("'self'"));
});

test("SETIAP blok skrip inline hash-nya terdaftar di script-src", () => {
  const src = scriptSrc();
  const hilang = hitungHashSkripInline(html).filter((h) => !src.includes(h));
  assert.deepEqual(hilang, [],
    `hash blok inline tidak ada di CSP -> browser akan MENOLAK menjalankannya: ${hilang.join(" ")}`);
});

test("tidak ada hash BASI di script-src (jumlah hash == jumlah blok inline)", () => {
  const jumlahDiCsp = (scriptSrc().match(/'sha256-/g) || []).length;
  const jumlahBlok = hitungHashSkripInline(html).length;
  assert.equal(jumlahDiCsp, jumlahBlok,
    `${jumlahDiCsp} hash di CSP vs ${jumlahBlok} blok inline -- hash basi memperlebar izin tanpa alasan`);
});

test("jumlah blok inline masuk akal (pendeteksi tidak diam-diam rusak)", () => {
  const n = hitungHashSkripInline(html).length;
  assert.ok(n >= 4, `cuma ${n} blok inline terdeteksi -- curiga regex pendeteksi rusak`);
});

test("index.html tidak memuat atribut handler inline (prasyarat kebijakan ini)", () => {
  // 'unsafe-inline' juga yang dulu mengizinkan onclick= dkk. Kalau atribut
  // handler kembali, ia TIDAK akan jalan lagi di bawah kebijakan ini -- tombol
  // mati senyap. Fase 4 (v101-v102) yang menghabiskannya; ini penjaganya.
  const handler = [...html.matchAll(/\son(?:click|change|input|submit|keyup|keydown|focus|blur)="/g)];
  assert.equal(handler.length, 0,
    `masih ada ${handler.length} atribut handler inline -- di bawah CSP tanpa 'unsafe-inline' semuanya mati`);
});

test("style-src masih 'unsafe-inline' -- disengaja & tercatat, bukan kelalaian", () => {
  // 37 atribut style="" dipakai untuk nilai dinamis (lebar bar progres, warna
  // dari data). Atribut style TIDAK bisa di-hash seperti blok skrip, jadi
  // melepasnya menuntut refactor terpisah. Tes ini mengunci FAKTA itu supaya
  // tidak ada yang mengira script-src dan style-src sudah sama ketatnya.
  const meta = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/)[1];
  const styleSrc = (meta.match(/style-src ([^;]*)/) || [])[1] || "";
  assert.ok(styleSrc.includes("'unsafe-inline'"),
    "kalau style-src sudah diperketat, perbarui catatan ini dan hapus tesnya");
  assert.ok(/\sstyle="/.test(html), "alasan pengecualian itu (atribut style dinamis) harus benar-benar masih ada");
});
