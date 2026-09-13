#!/usr/bin/env node
// ============================================================================
// scripts/schema-verify/run.mjs — bukti bahwa sql/schema.sql BISA memasang
// project baru dari nol, dijalankan di PostgreSQL sungguhan.
// ============================================================================
// Dipakai job CI "Schema install check (Postgres)" (.github/workflows/parity.yml)
// dan bisa dijalankan lokal (lihat README.md di folder ini).
//
// Tanpa dependensi npm sama sekali -- hanya butuh biner `psql` di PATH.
// Urutan yang diuji:
//   1. database KOSONG + shim Supabase          -> mensimulasikan project baru
//   2. sql/schema.sql dijalankan SEKALI          -> harus sukses tanpa error
//   3. sql/schema.sql dijalankan LAGI            -> harus tetap bersih (idempoten)
//   4. functional-check.sql                      -> RLS, ke-4 RPC, penolakan anon
//
// Latar (v95): schema.sql pernah "kelihatan lengkap" padahal di database kosong
// menghasilkan 0 function -- instalasi baru hidup tapi rusak. Script ini yang
// membuat kelas bug itu tidak bisa lolos diam-diam lagi.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const PGHOST = process.env.PGHOST || "127.0.0.1";
const PGPORT = process.env.PGPORT || "5432";
const PGUSER = process.env.PGUSER || "postgres";
const DBNAME = process.env.SCHEMA_CHECK_DB || "myfinance_schema_check";

const baseArgs = ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-v", "ON_ERROR_STOP=1", "-X"];

function psql({ db, file, command, quiet = true }) {
  const args = [...baseArgs, "-d", db];
  if (quiet) args.push("-q");
  if (file) args.push("-f", file);
  if (command) args.push("-c", command);
  return spawnSync("psql", args, { encoding: "utf8", env: process.env });
}

let failed = false;

function step(label, result, { allowNotices = true } = {}) {
  const stderr = (result.stderr || "")
    .split("\n")
    .filter((line) => line.trim() && (!allowNotices || !/^(NOTICE|psql:.*NOTICE)/.test(line)))
    .join("\n");

  if (result.status === 0 && !stderr) {
    console.log(`  OK    ${label}`);
    return true;
  }
  failed = true;
  console.log(`  GAGAL ${label}`);
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (detail) console.log(detail.split("\n").map((l) => `        ${l}`).join("\n"));
  return false;
}

// --------------------------------------------------------------- prasyarat
if (spawnSync("psql", ["--version"], { encoding: "utf8" }).status !== 0) {
  console.error("psql tidak ditemukan di PATH. Pasang postgresql-client dulu.");
  process.exit(2);
}
for (const f of ["sql/schema.sql", "scripts/schema-verify/supabase-shim.sql", "scripts/schema-verify/functional-check.sql"]) {
  if (!existsSync(resolve(ROOT, f))) {
    console.error(`File wajib tidak ada: ${f}`);
    process.exit(2);
  }
}

console.log(`\nSchema install check -> ${PGUSER}@${PGHOST}:${PGPORT}, database "${DBNAME}"\n`);

// 1. database baru yang benar-benar kosong
const dropped = psql({ db: "postgres", command: `drop database if exists ${DBNAME};` });
step("siapkan database kosong (drop)", dropped);
step("siapkan database kosong (create)", psql({ db: "postgres", command: `create database ${DBNAME};` }));
step("shim Supabase (auth.uid/auth.users/roles)", psql({ db: DBNAME, file: resolve(ROOT, "scripts/schema-verify/supabase-shim.sql") }));

// 2 & 3. instalasi + idempotensi
step("INSTALASI: sql/schema.sql di database kosong", psql({ db: DBNAME, file: resolve(ROOT, "sql/schema.sql") }));
step("IDEMPOTENSI: sql/schema.sql dijalankan ulang", psql({ db: DBNAME, file: resolve(ROOT, "sql/schema.sql") }));

// 3b. objek yang terbentuk harus lengkap (angka ini juga dijaga
//     tests/unit/sql-schema-completeness.test.js dari sisi teks file)
const counts = psql({
  db: DBNAME,
  quiet: false,
  command:
    "select (select count(*) from pg_tables where schemaname='public')" +
    " || '/' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')" +
    " || '/' || (select count(*) from pg_policies where schemaname='public');",
});
const summary = (counts.stdout || "").split("\n").map((l) => l.trim()).find((l) => /^\d+\/\d+\/\d+$/.test(l));
// v124: angka function jadi 5 karena set_platform_logos_updated_at (fungsi
// trigger pemelihara platform_logos.updated_at) akhirnya ikut didefinisikan
// di schema.sql. Sebelumnya fungsi itu HANYA ada di produksi dan tidak
// tercatat di berkas SQL mana pun di repo -- hasil audit drift 2026-09-13.
// Yang dihitung pg_proc adalah SEMUA function, jadi 5; "RPC" tetap 4.
const EXPECTED = "11/5/15"; // tabel/function/policy
if (summary === EXPECTED) {
  console.log(`  OK    objek terpasang lengkap (tabel/function/policy = ${summary})`);
} else {
  failed = true;
  console.log(`  GAGAL objek terpasang: dapat ${summary ?? "?"}, harusnya ${EXPECTED} (tabel/function/policy)`);
  console.log("        Kalau penambahan ini memang disengaja, perbarui EXPECTED di script ini.");
}

// 4. perilaku: RLS, RPC, penolakan anon
const functional = psql({ db: DBNAME, quiet: false, file: resolve(ROOT, "scripts/schema-verify/functional-check.sql") });
const lulus = (functional.stdout || "").includes(">>> SEMUA CEK LULUS");
if (functional.status === 0 && lulus) {
  const notices = (functional.stderr || "").split("\n").filter((l) => l.includes("LULUS"));
  console.log(`  OK    uji fungsional (${notices.length} cek)`);
  for (const n of notices) console.log(`        ${n.replace(/^NOTICE:\s*/, "")}`);
} else {
  failed = true;
  console.log("  GAGAL uji fungsional");
  console.log([functional.stdout, functional.stderr].filter(Boolean).join("\n").trim());
}

// bersih-bersih (tidak fatal kalau gagal, mis. koneksi masih nyangkut)
psql({ db: "postgres", command: `drop database if exists ${DBNAME};` });

console.log(failed ? "\nHASIL: ADA YANG GAGAL\n" : "\nHASIL: SEMUA LULUS\n");
process.exit(failed ? 1 : 0);
