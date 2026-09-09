// GUARD: angka di dokumen harus cocok dengan kenyataan di kode.
//
// Latar (v96): audit struktur repo menemukan sederet klaim basi yang menyesatkan
// pembaca baru (termasuk agen AI berikutnya) -- STRUKTUR-REPO menulis
// "CACHE_VERSION=v70" saat sw.js sudah v131, "37 file" domain saat isinya 38,
// "65 cek" saat verify-hud sudah 69, dan komentar dependabot masih menyebut
// supabase-js dimuat dari esm.sh padahal sudah di-vendor sejak v59. Dokumen di
// repo ini bukan hiasan: AGENT-HANDOFF & STRUKTUR-REPO adalah alat kerja utama
// tiap sesi, jadi angka yang salah = keputusan yang salah.
//
// Test ini menagih konsistensi angka SECARA MEKANIS, bukan lewat kedisiplinan.
// Kalau sebuah "pola jangkar" tidak ketemu lagi (kalimatnya ditulis ulang),
// test ini juga merah -- itu disengaja: perbarui jangkarnya di sini bersama
// dokumennya, jangan biarkan gerbangnya diam-diam berhenti menjaga.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

const struktur = read("STRUKTUR-REPO.md");
const readme = read("README.md");
const handoff = read("AGENT-HANDOFF.md");

// AGENT-HANDOFF.md sengaja TIDAK ikut diperiksa: isinya log historis per versi
// (entri v45 memang harus tetap menulis "500 unit test" -- itu fakta saat itu).

test("dokumen: CACHE_VERSION yang disebut cocok dengan sw.js", () => {
  const actual = read("sw.js").match(/CACHE_VERSION\s*=\s*['"]myfinance-v(\d+)['"]/)?.[1];
  assert.ok(actual, "CACHE_VERSION tidak terbaca dari sw.js -- formatnya berubah?");

  for (const [name, text] of [["STRUKTUR-REPO.md", struktur], ["README.md", readme]]) {
    for (const m of text.matchAll(/CACHE_VERSION\s*=\s*'?(?:myfinance-)?v(\d+)/g)) {
      assert.equal(
        m[1], actual,
        `${name} menyebut CACHE_VERSION=v${m[1]} padahal sw.js sudah v${actual}. ` +
        `Perbarui dokumennya (atau bump sw.js kalau memang aset berubah).`
      );
    }
  }
});

test("dokumen: versi terbaru di STRUKTUR-REPO = entri terakhir AGENT-HANDOFF", () => {
  const versions = [...handoff.matchAll(/^## v(\d+)\b/gm)].map((m) => Number(m[1]));
  assert.ok(versions.length > 5, "entri versi di AGENT-HANDOFF tidak terbaca -- format '## vNN' berubah?");
  const latest = Math.max(...versions);

  const claimed = struktur.match(/versi terbaru `v(\d+)`/);
  assert.ok(claimed, "pola 'versi terbaru `vNN`' hilang dari header STRUKTUR-REPO.md");
  assert.equal(
    Number(claimed[1]), latest,
    `STRUKTUR-REPO menulis versi terbaru v${claimed[1]}, tapi entri terakhir AGENT-HANDOFF v${latest}. ` +
    `Perbarui header STRUKTUR-REPO.md setiap menambah entri handoff.`
  );
});

test("dokumen: jumlah file src/domain & src/ui cocok dengan isi folder", () => {
  const count = (dir) => readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith(".js")).length;

  const domainLine = struktur.split("\n").find((l) => l.includes("domain/") && /\d+ file/.test(l));
  assert.ok(domainLine, "baris ringkasan 'domain/ ... NN file' hilang dari STRUKTUR-REPO.md");
  assert.equal(
    Number(domainLine.match(/(\d+) file/)[1]), count("src/domain"),
    `STRUKTUR-REPO menulis "${domainLine.trim()}" padahal src/domain berisi ${count("src/domain")} file.`
  );
});

test("dokumen: jumlah tabel & RPC cocok dengan sql/schema.sql", () => {
  const schema = read("sql/schema.sql");
  const tables = (schema.match(/^create table if not exists/gim) || []).length;
  const rpcs = (schema.match(/^create or replace function/gim) || []).length;
  assert.ok(tables > 5 && rpcs > 0, "parser schema.sql rusak?");

  // Jangkar spesifik supaya kalimat lain yang kebetulan memuat angka + "tabel"
  // (mis. "menambah 1 tabel baru") tidak ikut tertangkap.
  const anchors = [
    [readme, "README.md", /Ini membuat (\d+) tabel berikut/, tables],
    [readme, "README.md", /dijalankan lengkap \(semua (\d+) tabel/, tables],
    [readme, "README.md", /\((\d+) tabel \+ \d+ RPC/, tables],
    [readme, "README.md", /\(\d+ tabel \+ (\d+) RPC/, rpcs],
    [readme, "README.md", /Run cukup\): (\d+) tabel/, tables],
    [struktur, "STRUKTUR-REPO.md", /#\s+(\d+) tabel \(transactions/, tables],
    [struktur, "STRUKTUR-REPO.md", /\*\*Tabel Supabase \((\d+)\)\*\*/, tables],
  ];

  for (const [text, name, re, expected] of anchors) {
    const m = text.match(re);
    assert.ok(m, `pola ${re} tidak ketemu di ${name} -- kalimatnya ditulis ulang? Perbarui jangkar di test ini.`);
    assert.equal(
      Number(m[1]), expected,
      `${name} menyebut ${m[1]} lewat pola ${re}, kenyataan di sql/schema.sql = ${expected}.`
    );
  }
});

test("vendor: versi bundel browser supabase-js = versi paket npm", () => {
  // Kopling yang tidak kelihatan: browser memuat vendor/supabase-js-X.bundle.min.mjs
  // (di-pin di nama berkas), sementara skrip parity sisi Node memakai paket npm
  // @supabase/supabase-js. Dependabot hanya menaikkan yang npm. Tanpa gerbang ini
  // keduanya bisa berpisah jalan berbulan-bulan tanpa satu pun test merah, dan
  // parity "live" jadi menguji versi klien yang TIDAK dipakai pengguna.
  const vendored = readdirSync(resolve(ROOT, "vendor"))
    .map((f) => f.match(/^supabase-js-(\d+\.\d+\.\d+)\.bundle\.min\.mjs$/))
    .filter(Boolean);
  assert.equal(vendored.length, 1, `harus ada tepat 1 bundel supabase-js di vendor/, ketemu ${vendored.length}`);

  const pkg = JSON.parse(read("package.json"));
  const npmVersion = (pkg.devDependencies["@supabase/supabase-js"] || "").replace(/^[\^~]/, "");
  assert.equal(
    vendored[0][1], npmVersion,
    `vendor/ memuat supabase-js ${vendored[0][1]} tapi package.json meminta ${npmVersion}.\n` +
    `  Kalau ini datang dari PR Dependabot: bundel browser TIDAK ikut naik sendiri.\n` +
    `  Ikuti prosedur vendor ulang di vendor/README.md (unduh bundel versi baru,\n` +
    `  perbarui import di src/services/supabase/client.js + precache sw.js + bump CACHE_VERSION),\n` +
    `  atau turunkan kembali versi npm-nya kalau memang belum mau pindah.`
  );
});

test("dokumen: jumlah cek tiap harness E2E cocok dengan skripnya", () => {
  // Tiap harness mendaftarkan cek lewat helper ok(...) -- hitung pemanggilannya.
  // Latar v88: harness manual jadi basi berbulan-bulan tanpa ketahuan karena
  // tidak ada yang mencocokkan angka di dokumen dengan isi skripnya.
  const harnesses = ["verify-hud", "verify-asset-logos", "verify-applock", "verify-applock-biometric", "verify-offline-cache", "verify-ui-actions", "verify-csp", "verify-ui-sweep", "verify-applock-rpid"];
  const actual = Object.fromEntries(
    harnesses.map((h) => [h, (read(`scripts/${h}.mjs`).match(/\bok\(/g) || []).length])
  );
  for (const [h, n] of Object.entries(actual)) {
    assert.ok(n > 5, `hitungan cek ${h} mencurigakan (${n}) -- helper ok() diganti nama?`);
  }

  const docs = [
    ["STRUKTUR-REPO.md", struktur],
    ["README.md", readme],
    [".github/workflows/e2e-harness.yml", read(".github/workflows/e2e-harness.yml")],
    // Hanya blok "Peta cepat" AGENT-HANDOFF: bagian itu SEHARUSNYA selalu
    // menggambarkan kondisi sekarang (v97 menemukannya masih menulis 49 cek
    // padahal sudah 69). Entri "## vNN" di bawahnya tetap dikecualikan.
    ["AGENT-HANDOFF.md (Peta cepat)", handoff.split(/^## /m)[1] || ""],
  ];

  let checked = 0;
  for (const [name, text] of docs) {
    for (const line of text.split("\n")) {
      // "verify-applock" adalah AWALAN dari "verify-applock-biometric" -- kalau
      // dicocokkan apa adanya, baris tentang harness biometrik (14 cek) akan
      // dinilai memakai angka harness applock (21) dan guard ini jadi bohong.
      // Ambil nama TERPANJANG yang cocok pada baris itu saja.
      const match = harnesses
        .filter((h) => line.includes(h))
        .sort((a, b) => b.length - a.length)[0];
      if (!match) continue;
      for (const m of line.matchAll(/(\d+)\s*cek/g)) {
        assert.equal(
          Number(m[1]), actual[match],
          `${name} menyebut "${m[1]} cek" untuk ${match}, padahal skripnya punya ${actual[match]} pemanggilan ok().\n` +
          `  Baris: ${line.trim()}`
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 5, `hanya ${checked} klaim jumlah cek yang terperiksa -- pola penyebutan berubah?`);
});
