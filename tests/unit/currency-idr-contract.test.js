// GUARD KONTRAK SILANG-LAPISAN: transfer IDR-ke-IDR (mata uang NULL).
//
// LATAR (v123, 2026-09-12) -- bug nyata yang lolos dari SEMUA gerbang yang ada:
//
//   Lapisan JS  (src/services/supabase/transfers.js) SENGAJA mengirim
//   p_mata_uang_sumber = NULL untuk akun IDR -- itu konvensi seluruh app
//   (`currentTxMataUang = null` di app.src.js; kolom transactions.mata_uang
//   nullable). Kontrak itu bahkan ditegaskan eksplisit oleh
//   tests/unit/rpc-param-shapes.test.js ("transfer IDR-ke-IDR biasa (mayoritas
//   transfer di app ini)").
//
//   Lapisan SQL (RPC create_transfer_transaction) menolak NULL:
//       if nullif(trim(p_mata_uang_sumber), '') is null or ... then
//           raise exception 'Mata uang sumber dan tujuan wajib diisi';
//
//   Keduanya hijau secara terpisah: unit test memakai MOCK client sehingga tidak
//   pernah menyentuh Postgres, dan scripts/schema-verify/functional-check.sql
//   CEK 3 hanya menguji transfer LINTAS mata uang (USD -> IDR). Hasilnya:
//   transfer IDR-ke-IDR -- kasus mayoritas -- gagal di database, tanpa satu pun
//   gerbang merah, dan docs/supabase-native-migration-plan.md malah menandai
//   gate "Transfer IDR->IDR ... terverifikasi" sebagai terpenuhi.
//
// Test ini menjahit kedua lapisan supaya kontradiksi semacam itu tidak bisa
// terulang: ia menagih PERILAKU JS, TEKS SQL, dan KASUS UJI Postgres-nya
// sekaligus, dalam satu tempat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildTransferPreview, createTransfer, toTransferParams } from "../../src/services/supabase/transfers.js";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

/** Ambil body satu function plpgsql dari berkas SQL (pola sama dgn sql-schema-completeness). */
function extractFunction(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) return null;
  const end = sql.indexOf("\n$$;", start);
  return end < 0 ? null : sql.slice(start, end + "\n$$;".length);
}

/** Buang komentar `--` supaya penegasan tidak tersandung teks penjelasan di dalam SQL. */
const stripSqlComments = (s) => s.replace(/--[^\n]*/g, "");

const TRANSFER_SQL_FILES = [
  "sql/schema.sql",
  "sql/migrations/migration_transfer_currency_2026-08.sql",
];

test("kontrak JS: transfer tanpa mata uang mengirim NULL + kurs 1 (bukan string 'IDR')", () => {
  // Persis kondisi default app: currentTxMataUang = null, currentTxKurs = 1.
  const params = toTransferParams({
    tanggal: "2026-09-12",
    jumlah: 250000,
    akun_sumber: "BCA",
    akun_tujuan: "Cash",
    mata_uang_sumber: null,
    mata_uang_tujuan: null,
    kurs_sumber: 1,
    kurs_tujuan: 1,
    keterangan: null,
  });
  assert.equal(params.sourceCurrency, null);
  assert.equal(params.destinationCurrency, null);
  assert.equal(params.sourceRateIdrPerUnit, 1);
  assert.equal(params.destinationRateIdrPerUnit, 1);

  const preview = buildTransferPreview(params);
  assert.equal(preview.destinationAmount, 250000, "IDR->IDR harus 1:1, bukan 0/NaN");
  assert.equal(preview.sourceAmountIdr, 250000);
  assert.ok(Number.isFinite(preview.destinationAmount), "nominal tujuan harus angka hingga");
});

test("kontrak JS->RPC: payload yang benar-benar dikirim memakai NULL + kurs positif", async () => {
  const calls = [];
  const client = { rpc: async (fn, p) => { calls.push({ fn, params: p }); return { data: null, error: null }; } };

  await createTransfer(client, {
    tanggal: "2026-09-12",
    sourceAmount: 250000,
    sourceAccount: "BCA",
    destinationAccount: "Cash",
    // sourceCurrency / destinationCurrency / rate SENGAJA tidak diisi.
  });

  assert.equal(calls.length, 1);
  const p = calls[0].params;
  assert.equal(calls[0].fn, "create_transfer_transaction");
  assert.equal(p.p_mata_uang_sumber, null);
  assert.equal(p.p_mata_uang_tujuan, null);

  // INI jembatan kontraknya: satu-satunya validasi yang masih tersisa di RPC
  // setelah v123 adalah "kurs harus > 0". Selama JS selalu mengirim kurs
  // positif, payload IDR-ke-IDR tidak mungkin ditolak database.
  for (const [nama, nilai] of [["p_kurs_sumber", p.p_kurs_sumber], ["p_kurs_tujuan", p.p_kurs_tujuan]]) {
    assert.equal(typeof nilai, "number", `${nama} harus number, bukan ${typeof nilai} (${nilai})`);
    assert.ok(Number.isFinite(nilai) && nilai > 0,
      `${nama} = ${nilai} akan DITOLAK RPC ('Kurs sumber dan tujuan harus lebih besar dari nol').`);
  }
});

test("kontrak SQL: RPC tidak lagi menolak mata uang NULL, tapi tetap menolak kurs <= 0", () => {
  for (const rel of TRANSFER_SQL_FILES) {
    const body = extractFunction(read(rel), "create_transfer_transaction");
    assert.ok(body, `create_transfer_transaction tidak ketemu di ${rel}`);

    const code = stripSqlComments(body);
    assert.ok(!code.includes("Mata uang sumber dan tujuan wajib diisi"),
      `${rel} MASIH menolak mata uang NULL/kosong. Padahal lapisan JS mengirim NULL untuk akun IDR ` +
      `(konvensi app) -- transfer IDR-ke-IDR akan gagal di database. Lihat header test ini.`);

    // Normalisasi harus ada di KEDUA berkas (schema.sql = instalasi baru,
    // migrasi kanonik = yang diterapkan ke database live).
    for (const pola of [
      "nullif(trim(coalesce(p_mata_uang_sumber, '')), '')",
      "nullif(trim(coalesce(p_mata_uang_tujuan, '')), '')",
      "coalesce(p_kurs_sumber, 1)",
      "coalesce(p_kurs_tujuan, 1)",
    ]) {
      assert.ok(body.includes(pola), `normalisasi \`${pola}\` hilang dari ${rel}`);
    }

    // Pelonggaran mata uang TIDAK boleh ikut melonggarkan validasi kurs.
    assert.ok(body.includes("Kurs sumber dan tujuan harus lebih besar dari nol"),
      `${rel} kehilangan penolakan kurs <= 0 -- jangan longgarkan validasi itu bersama mata uang.`);

    // Perhitungan harus memakai nilai ternormalisasi, bukan parameter mentah.
    assert.ok(body.includes("v_source_idr := p_jumlah * v_kurs_sumber;"),
      `${rel} masih menghitung jumlah_idr dari p_kurs_sumber mentah (NULL -> hasil NULL).`);
    assert.ok(body.includes("v_target_amount := v_source_idr / v_kurs_tujuan;"),
      `${rel} masih menghitung nominal tujuan dari p_kurs_tujuan mentah (NULL -> hasil NULL).`);

    // Baris yang disimpan harus memakai mata uang ternormalisasi, supaya IDR
    // tersimpan NULL (konsisten dgn baris Pemasukan/Pengeluaran), bukan ''.
    assert.ok(body.includes("p_keterangan, v_mata_uang_sumber, v_kurs_sumber, v_source_idr,"),
      `${rel} tidak menyimpan v_mata_uang_sumber/v_kurs_sumber -- kolom mata_uang/kurs bisa salah isi.`);
    assert.ok(body.includes("v_target_amount, v_mata_uang_tujuan, v_kurs_tujuan, v_source_idr"),
      `${rel} tidak menyimpan v_mata_uang_tujuan/v_kurs_tujuan.`);
  }
});

test("bukti Postgres: functional-check.sql punya kasus IDR-ke-IDR (bukan cuma lintas mata uang)", () => {
  const cek = read("scripts/schema-verify/functional-check.sql");

  // CEK 3 saja tidak cukup: itu kasus USD->IDR. Yang dulu hilang persis kasus
  // same-currency dengan mata uang NULL.
  assert.ok(cek.includes("CEK 3c"),
    "CEK 3c (transfer IDR-ke-IDR dengan mata uang NULL) hilang dari functional-check.sql. " +
    "Tanpa kasus ini, gerbang Postgres di CI tidak pernah menjalankan jalur transfer mayoritas.");

  assert.ok(/create_transfer_transaction\(\s*\n?\s*current_date, 250000, 'BCA', 'Cash', NULL, NULL, NULL, NULL/.test(cek),
    "panggilan uji transfer dengan SEMUA argumen mata uang/kurs NULL hilang dari functional-check.sql.");

  // Validasi kurs harus tetap teruji, supaya pelonggaran tidak kebablasan.
  assert.ok(cek.includes("CEK 3h"), "kasus uji 'kurs 0 tetap ditolak' (CEK 3h) hilang dari functional-check.sql.");
});

// ---------------------------------------------------------------------------
// KELAS BUG YANG SAMA di RPC kedua: snapshot IDR.
//
// create_recurring_transaction menyimpan `coalesce(p_jumlah_idr, p_jumlah)` --
// menyalin nominal MENTAH. Lapisan JS (src/services/supabase/recurring.js) sudah
// meneruskan p_mata_uang/p_kurs, jadi begitu tabel recurring_transactions punya
// kolom mata uang (gap yang tercatat di docs/supabase-native-migration-plan.md),
// template USD 100 @16.000 akan tersimpan dengan jumlah_idr = 100 -- persis
// regresi "USD 100 jadi Rp 100" yang sudah dijaga di jalur transfer (CEK 3a/3b)
// tapi belum di jalur berulang. Diperbaiki di v123 sebelum sempat terpicu.
// ---------------------------------------------------------------------------
const RECURRING_SQL_FILES = [
  "sql/schema.sql",
  "sql/migrations/migration_reliability_hardening_2026-08.sql",
];

test("kontrak SQL: create_recurring_transaction menghitung jumlah_idr dari kurs", () => {
  for (const rel of RECURRING_SQL_FILES) {
    const raw = extractFunction(read(rel), "create_recurring_transaction");
    assert.ok(raw, `create_recurring_transaction tidak ketemu di ${rel}`);
    // Komentar di dalam body SENGAJA menyebut bentuk lama sebagai penjelasan
    // ("Sebelumnya `coalesce(p_jumlah_idr, p_jumlah)` ..."), jadi pemeriksaan
    // negatif harus membaca KODE-nya saja, bukan teks komentarnya.
    const body = stripSqlComments(raw);

    assert.ok(!/coalesce\(p_jumlah_idr, p_jumlah\)/.test(body),
      `${rel} masih menyimpan coalesce(p_jumlah_idr, p_jumlah) -- nominal asing akan ` +
      `tersalin mentah jadi jumlah_idr (USD 100 -> Rp 100). Hitung dari p_kurs.`);

    assert.ok(body.includes("case when p_kurs is not null then p_jumlah * p_kurs else p_jumlah end"),
      `${rel} kehilangan perhitungan jumlah_idr dari kurs. Jalur IDR (kurs NULL) harus ` +
      `tetap menghasilkan p_jumlah supaya perilaku pemanggil hari ini tidak berubah.`);
  }

  // Bukti di Postgres nyata harus ada, bukan cuma di tingkat teks.
  const cek = read("scripts/schema-verify/functional-check.sql");
  for (const label of ["CEK 4c", "CEK 4d", "CEK 4e"]) {
    assert.ok(cek.includes(label),
      `${label} hilang dari functional-check.sql (kurs asing / jalur IDR / p_jumlah_idr eksplisit).`);
  }
});

test("kontrak JS: lapisan recurring sudah meneruskan mata uang & kurs ke RPC", () => {
  // Ini sisi yang membuat jebakan di atas "sudah terpasang" walau belum bisa
  // terpicu dari UI -- kalau suatu saat penerusan ini dihapus, test ini ikut
  // memberi tahu bahwa alasan hardening SQL-nya berubah.
  const svc = read("src/services/supabase/recurring.js");
  assert.ok(svc.includes("p_mata_uang: input.mataUang || null"),
    "penerusan p_mata_uang di src/services/supabase/recurring.js berubah bentuk.");
  assert.ok(svc.includes("p_kurs: input.kurs != null ? Number(input.kurs) : null"),
    "penerusan p_kurs di src/services/supabase/recurring.js berubah bentuk.");
});
