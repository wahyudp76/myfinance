// GUARD: kontrak alat pembanding drift scripts/schema-verify/drift-check.mjs.
//
// Latar (v124, audit drift live-vs-repo 2026-09-13): drift-check.mjs menjalankan
// isi catalog-queries.json langsung ke DATABASE PRODUKSI lewat Supabase
// Management API. Itu membuat berkas JSON tersebut satu-satunya tempat di repo
// ini yang isinya dieksekusi di produksi dengan token level akun. Kalau suatu
// saat ada yang menyelipkan satu kata `delete` ke dalamnya, `--live-check` akan
// menjalankannya diam-diam. Guard pertama di bawah ada untuk itu.
//
// Selain itu, expected-catalog.json adalah kontrak yang dibandingkan CI. Kalau
// isinya basi (schema.sql berubah, snapshot tidak diperbarui), `--check` merah
// di CI -- tapi test di bawah menangkap sebagian kasus lebih awal dan dengan
// pesan yang lebih jelas, tanpa butuh biner psql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseTables,
  parseSqlFunctions,
  parseTriggerNames,
  stripSqlComments,
} from "../../scripts/schema-verify/sql-parse.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

const QUERIES = JSON.parse(read("scripts/schema-verify/catalog-queries.json"));
const SNAPSHOT = JSON.parse(read("scripts/schema-verify/expected-catalog.json"));
const TOOL = read("scripts/schema-verify/drift-check.mjs");
const schema = read("sql/schema.sql");

const KATEGORI = Object.keys(QUERIES).filter((k) => !k.startsWith("_"));

// Kata kerja yang tidak boleh muncul di query katalog. Diperiksa SETELAH literal
// string dibuang, karena query sah memuat 'EXECUTE' di dalam
// has_function_privilege('anon', p.oid, 'EXECUTE').
const DILARANG = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|call|copy|do|execute|set|begin|commit|rollback|vacuum|reindex|cluster|comment|security|refresh|notify|listen|load)\b/i;

/** Buang literal string '...' (termasuk '' sebagai escape) dari SQL. */
const buangLiteral = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");

test("drift-check: SEMUA query katalog read-only (dijalankan ke produksi!)", () => {
  assert.ok(KATEGORI.length >= 8,
    `catalog-queries.json cuma punya ${KATEGORI.length} kategori -- ada yang terhapus?`);

  for (const name of KATEGORI) {
    const q = QUERIES[name];
    assert.equal(typeof q, "string", `${name}: query harus string`);
    assert.match(q.trim(), /^select\b/i,
      `${name}: query katalog HARUS diawali SELECT. Alat ini dijalankan ke database `
      + "produksi lewat Management API, jadi bentuk lain apa pun tidak diterima.");

    const bersih = buangLiteral(stripSqlComments(q));
    const m = bersih.match(DILARANG);
    assert.equal(m, null,
      `${name}: query katalog memuat kata kerja terlarang "${m && m[0]}". `
      + "Kalau ini memang bagian dari nama kolom/fungsi, tambahkan penjelasannya di "
      + "_komentar catalog-queries.json dan persempit regex DILARANG di test ini -- "
      + "jangan menghapus guard-nya.");
    assert.ok(!/;\s*\S/.test(q), `${name}: query tidak boleh memuat lebih dari satu statement.`);
  }
});

test("drift-check: snapshot memakai kategori yang sama dengan query", () => {
  for (const name of KATEGORI) {
    assert.ok(Array.isArray(SNAPSHOT[name]),
      `expected-catalog.json kehilangan kategori "${name}"`);
  }
  const ekstra = Object.keys(SNAPSHOT).filter((k) => !k.startsWith("_") && !KATEGORI.includes(k));
  assert.deepEqual(ekstra, [],
    `expected-catalog.json punya kategori yang tidak ada di catalog-queries.json: ${ekstra}. `
    + "Snapshot harus dibangkitkan ulang dengan --check --update-snapshot.");
});

test("drift-check: jumlah entri snapshot = kenyataan di sql/schema.sql", () => {
  // Snapshot dibangkitkan dari pemasangan schema.sql, jadi jumlah barisnya harus
  // bisa diturunkan langsung dari teks schema.sql. Kalau salah satu berubah
  // tanpa yang lain, snapshot-nya basi.
  const tabel = parseTables(schema);
  const fungsi = parseSqlFunctions(schema);
  const totalKolom = [...tabel.values()].reduce((n, t) => n + t.columns.size, 0);
  const policy = (schema.match(/^create policy /gim) || []).length;
  const trigger = parseTriggerNames(schema).size;

  const harapan = {
    tables: tabel.size,
    columns: totalKolom,
    functions: fungsi.length,
    function_grants: fungsi.length,
    policies: policy,
    triggers: trigger,
  };
  for (const [cat, n] of Object.entries(harapan)) {
    assert.equal(SNAPSHOT[cat].length, n,
      `expected-catalog.json kategori "${cat}" punya ${SNAPSHOT[cat].length} entri, `
      + `padahal sql/schema.sql mendefinisikan ${n}. Jalankan `
      + "`node scripts/schema-verify/drift-check.mjs --check --update-snapshot` "
      + "lalu BACA diff-nya sebelum commit.");
  }
});

test("drift-check: selisih yang diizinkan tetap terdokumentasi di schema.sql", () => {
  // DIHARAPKAN_HANYA_DI_LIVE adalah satu-satunya tempat drift boleh disembunyikan,
  // jadi tiap entri di sana harus punya penjelasan di schema.sql sendiri. Kalau
  // tidak, daftar itu akan tumbuh jadi tempat membuang temuan.
  const m = TOOL.match(/const DIHARAPKAN_HANYA_DI_LIVE = \{([\s\S]*?)\n\};/);
  assert.ok(m, "bentuk DIHARAPKAN_HANYA_DI_LIVE berubah -- perbarui jangkar di test ini.");
  const nama = [...m[1].matchAll(/^\s{2}\w+: \[([^\]]*)\]/gm)]
    .flatMap((x) => [...x[1].matchAll(/"([^"]+)"/g)].map((y) => y[1]));
  assert.ok(nama.length > 0, "daftar izin kosong -- parser test ini rusak, atau daftarnya dihapus?");
  for (const n of [...new Set(nama)]) {
    assert.ok(schema.includes(n),
      `"${n}" diizinkan hanya ada di produksi, tapi sql/schema.sql tidak menyebutnya sama `
      + "sekali. Izin tanpa penjelasan di sumbernya = drift yang disembunyikan. "
      + "Sebutkan objek itu di header schema.sql (lihat catatan OPSIONAL tentang "
      + "event_trigger_ensure_rls.sql) atau hapus dari daftar izin.");
  }
});

test("drift-check: tidak ada kredensial tertanam di alat maupun snapshot", () => {
  for (const [name, text] of [["drift-check.mjs", TOOL],
    ["catalog-queries.json", read("scripts/schema-verify/catalog-queries.json")],
    ["expected-catalog.json", read("scripts/schema-verify/expected-catalog.json")]]) {
    assert.ok(!/sbp_[A-Za-z0-9]/.test(text), `${name} memuat personal access token Supabase.`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(text),
      `${name} memuat sesuatu yang berbentuk JWT.`);
    assert.ok(!/service_role\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/.test(text),
      `${name} memuat service_role key.`);
  }
  // Token hanya boleh dibaca dari lingkungan, tidak pernah punya nilai bawaan.
  assert.match(TOOL, /process\.env\.SUPABASE_ACCESS_TOKEN/,
    "drift-check.mjs harus membaca token dari SUPABASE_ACCESS_TOKEN.");
  assert.ok(!/SUPABASE_ACCESS_TOKEN\s*\|\|\s*["'][A-Za-z0-9_]/.test(TOOL),
    "token punya nilai bawaan hardcoded di drift-check.mjs.");
});
