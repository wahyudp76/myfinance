#!/usr/bin/env node
// scripts/schema-verify/drift-check.mjs — pembanding katalog DATABASE LIVE vs
// sql/schema.sql.
//
// KENAPA FILE INI ADA (audit drift live-vs-repo, 2026-09-13):
// tests/unit/sql-schema-completeness.test.js hanya membandingkan berkas-berkas
// DI REPO satu sama lain, dan job CI "Schema install check" hanya membuktikan
// schema.sql bisa dipasang dari nol. Keduanya hijau sementara database produksi
// bisa berbeda. Itu bukan hipotesis: audit menemukan `platform_logos.id`
// bertipe bigint di produksi vs uuid di repo, sebuah CHECK constraint yang
// hilang, sebuah trigger + index yang tidak pernah tercatat di repo, dan satu
// RPC yang body-nya versi ketiga yang tidak pernah di-commit. Semua itu bertahan
// lama karena TIDAK ADA penjaga yang membandingkan produksi dengan repo.
//
// File ini menutup lubang itu. Query-nya ada di catalog-queries.json supaya sisi
// referensi dan sisi produksi diperiksa dengan SQL yang benar-benar identik.
//
// CARA PAKAI
//   node scripts/schema-verify/drift-check.mjs --check
//       Bangun database referensi dari sql/schema.sql (butuh biner psql, sama
//       seperti run.mjs), lalu bandingkan dengan expected-catalog.json yang
//       ter-commit. INI YANG DIJALANKAN CI. Tidak butuh kredensial apa pun, jadi
//       menangkap regresi di sisi repo: kalau ada yang diam-diam mengubah tipe
//       kolom atau menghapus constraint dari schema.sql, job ini merah.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=xxxxxxxxxxxx \
//     node scripts/schema-verify/drift-check.mjs --live-check
//       Bandingkan DATABASE PRODUKSI dengan expected-catalog.json. Dijalankan
//       MANUAL oleh pemilik repo (token level akun, jadi sengaja tidak pernah
//       ditempel di CI). READ-ONLY sepenuhnya: hanya SELECT terhadap katalog.
//
//   --dump-psql <dir> | --dump-live <dir> | --snapshot <dir> | --compare <a> <b>
//       Mode mentah untuk menelusuri selisih tertentu.
//
// MEMPERBARUI expected-catalog.json (setelah perubahan skema yang DISENGAJA):
//   node scripts/schema-verify/drift-check.mjs --check --update-snapshot
//   lalu periksa diff-nya baris per baris sebelum di-commit. Jangan pernah
//   memperbarui snapshot tanpa membaca selisihnya -- itu justru menghilangkan
//   seluruh nilai alat ini.
//
// SELISIH YANG DIHARAPKAN (lihat DIHARAPKAN_HANYA_DI_LIVE di bawah). Selain itu,
// dua perbedaan bentuk function sengaja dinormalkan, bukan diabaikan:
//   * komentar di dalam body (produksi pernah mendapat versi berkomentar lebih
//     pendek; kodenya identik byte-per-byte setelah komentar dibuang)
//   * akhir baris CRLF vs LF (objek buatan Supabase Dashboard tersimpan dengan
//     CRLF; berkas repo memakai LF)
// Keduanya dibuang sebelum body di-hash, jadi yang dibandingkan adalah KODE.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { stripSqlComments } from "./sql-parse.mjs";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "../..");
const QUERIES = JSON.parse(readFileSync(resolve(HERE, "catalog-queries.json"), "utf8"));
const SNAPSHOT = resolve(HERE, "expected-catalog.json");
const DBNAME = process.env.SCHEMA_CHECK_DB || "myfinance_drift_check";

const KATEGORI = Object.keys(QUERIES).filter((k) => !k.startsWith("_"));

// ---------------------------------------------------------------------------
// Selisih yang MEMANG diharapkan, dengan alasannya. Kalau sebuah entri di sini
// sudah tidak berlaku (mis. rls_auto_enable akhirnya diangkat ke schema.sql),
// hapus barisnya -- jangan biarkan daftar ini tumbuh jadi tempat menyembunyikan
// drift yang sebenarnya.
// ---------------------------------------------------------------------------
const DIHARAPKAN_HANYA_DI_LIVE = {
  // schema.sql baris ~54 menyatakan dengan eksplisit bahwa
  // migrations/event_trigger_ensure_rls.sql dan
  // migrations/migration_f1_rls_auto_enable_2026-08-31.sql adalah OPSIONAL dan
  // butuh hak superuser + keputusan sadar. Produksi memakainya (event trigger
  // `ensure_rls` aktif); instalasi baru dari schema.sql tidak. Itu keputusan
  // yang terdokumentasi, bukan drift.
  functions: ["rls_auto_enable"],
  function_grants: ["rls_auto_enable"],
};

const KATEGORI_DIBANDING = {
  // per kategori: bidang yang dipakai sebagai IDENTITAS entri (sisanya
  // dibandingkan sebagai isi). Identitas harus stabil di kedua sisi.
  tables: (r) => r.tabel,
  columns: (r) => `${r.tabel}.${r.kolom}`,
  functions: (r) => r.nama,
  function_grants: (r) => r.nama,
  policies: (r) => `${r.tabel} :: ${r.policy}`,
  indexes: (r) => `${r.tabel} :: ${r.index}`,
  constraints: (r) => `${r.tabel} :: ${r.nama}`,
  triggers: (r) => `${r.tabel} :: ${r.trigger}`,
  sequences_views: (r) => `${r.jenis} :: ${r.nama}`,
};

// ---------------------------------------------------------------------------
// Normalisasi
// ---------------------------------------------------------------------------
const kanon = (v) => (v == null ? "" : String(v).replace(/\r/g, "").replace(/\s+/g, " ").trim());

/** Hash kode function: komentar, CRLF, dan whitespace berlebih dibuang dulu. */
function hashBody(body) {
  const kode = kanon(stripSqlComments(kanon(body ?? ""))).replace(/\s*([(),;])\s*/g, "$1");
  return createHash("sha256").update(kode).digest("hex").slice(0, 16);
}

/** Baris katalog -> Map identitas -> string kanonik seluruh isinya. */
function petakan(category, rows) {
  const out = new Map();
  for (const r of rows) {
    const id = KATEGORI_DIBANDING[category](r);
    let isi;
    if (category === "functions") {
      isi = [
        kanon(r.argumen), kanon(r.hasil), r.bahasa, String(r.security_definer),
        kanon(r.setting), r.volatile, hashBody(r.body),
      ].join(" | ");
    } else {
      // SPASI DI SEKITAR "=" INI DISENGAJA -- JANGAN DIRAPIHKAN.
      // Tanpa spasi, aturan `generic-api-key` milik gitleaks menandai snapshot
      // ini sebagai kebocoran rahasia. Mekanisme pastinya: nama constraint
      // Postgres yang sah mengandung kata kunci "api"/"key" (api_rate_limits,
      // *_pkey, *_fkey), lalu nilai yang menempel pada "=" ikut tertelan
      // karena kelas karakter nilai gitleaks mengizinkan "=", sehingga
      // "definisi=PRIMARY" (16 karakter) dianggap secret. Pernah terjadi
      // sungguhan: 20 temuan palsu di commit v124 membuat job secret-scan
      // merah. Dengan spasi, nilai yang tertangkap tinggal "PRIMARY" (7
      // karakter) -- di bawah ambang 10 karakter aturan itu. Sudah diuji:
      // service_role JWT, GitHub PAT, dan token sbp_ SUNGGUHAN tetap
      // terdeteksi setelah perubahan ini (lihat .gitleaks.toml).
      isi = Object.keys(r).sort()
        .filter((k) => k !== "body")
        .map((k) => `${k} = ${kanon(r[k])}`)
        .join(" | ");
    }
    if (out.has(id) && out.get(id) !== isi) {
      // Dua baris dengan identitas sama tapi isi beda = duplikat di salah satu
      // sisi. Pernah terjadi sungguhan: schema.sql memasang dua CHECK identik
      // dengan nama berbeda (audit v124, F12). Jangan ditelan diam-diam.
      out.set(id, `${isi}  <<< DUPLIKAT IDENTITAS`);
    } else {
      out.set(id, isi);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sumber katalog
// ---------------------------------------------------------------------------
function psql({ db, file, command }) {
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1"];
  if (file) args.push("-f", file);
  if (command) args.push("-c", command);
  args.push("-d", db);
  const r = spawnSync("psql", args, { encoding: "utf8", env: process.env });
  if (r.status !== 0) {
    throw new Error(`psql gagal (db=${db}): ${(r.stderr || r.stdout || "").trim().split("\n")[0]}`);
  }
  return r.stdout || "";
}

/** Bentuk psql yang benar: flag -A -t sebagai argumen terpisah. */
function dumpViaPsql(dir) {
  if (spawnSync("psql", ["--version"], { encoding: "utf8" }).status !== 0) {
    throw new Error("psql tidak ditemukan di PATH. Pasang postgresql-client dulu.");
  }
  psql({ db: "postgres", command: `drop database if exists ${DBNAME};` });
  psql({ db: "postgres", command: `create database ${DBNAME};` });
  try {
    psql({ db: DBNAME, file: resolve(ROOT, "scripts/schema-verify/supabase-shim.sql") });
    psql({ db: DBNAME, file: resolve(ROOT, "sql/schema.sql") });
    mkdirSync(dir, { recursive: true });
    const hasil = {};
    for (const name of KATEGORI) {
      const r = spawnSync("psql", [
        "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DBNAME,
        "-c", `select row_to_json(t) from (${QUERIES[name]}) t`,
      ], { encoding: "utf8", env: process.env });
      if (r.status !== 0) throw new Error(`psql gagal saat dump ${name}: ${(r.stderr || "").trim().split("\n")[0]}`);
      hasil[name] = r.stdout || "";
    }
    return tulisDump(dir, hasil);
  } finally {
    psql({ db: "postgres", command: `drop database if exists ${DBNAME};` });
  }
}

/** stdout NDJSON psql -> berkas JSON per kategori (bentuk sama dengan sisi live). */
function tulisDump(dir, ndjsonPerKategori) {
  const ringkas = {};
  for (const name of KATEGORI) {
    const rows = ndjsonPerKategori[name].split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(rows, null, 1));
    ringkas[name] = rows.length;
  }
  return ringkas;
}

async function dumpViaLive(dir) {
  const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SBP;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token) {
    throw new Error(
      "butuh SUPABASE_ACCESS_TOKEN (personal access token sbp_...). JANGAN pernah "
      + "menempelkannya di berkas repo atau di workflow CI."
    );
  }
  if (!ref) throw new Error("butuh SUPABASE_PROJECT_REF (contoh: uxfngmxghupdlwoeoxgh).");
  mkdirSync(dir, { recursive: true });
  const ringkas = {};
  for (const name of KATEGORI) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERIES[name] }),
    });
    if (!res.ok) throw new Error(`Management API ${res.status} untuk ${name}: ${(await res.text()).slice(0, 160)}`);
    const rows = await res.json();
    writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(rows, null, 1));
    ringkas[name] = rows.length;
  }
  return ringkas;
}

function bacaDump(dir) {
  const out = {};
  for (const name of KATEGORI) {
    out[name] = JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8"));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Perbandingan
// ---------------------------------------------------------------------------
function bandingkan(a, b, labelA, labelB) {
  const masalah = [];
  const ringkasan = [];
  for (const cat of KATEGORI) {
    const A = petakan(cat, a[cat] ?? []);
    const B = petakan(cat, b[cat] ?? []);
    const diizinkan = new Set(DIHARAPKAN_HANYA_DI_LIVE[cat] ?? []);
    const hanyaB = [...B.keys()].filter((k) => !A.has(k));
    const hanyaA = [...A.keys()].filter((k) => !B.has(k));
    const beda = [...A.keys()].filter((k) => B.has(k) && A.get(k) !== B.get(k));

    const takDiduga = hanyaB.filter((k) => !diizinkan.has(k.split(" :: ").pop()));
    for (const k of hanyaA) masalah.push([cat, `hanya di ${labelA}`, k, A.get(k), ""]);
    for (const k of takDiduga) masalah.push([cat, `hanya di ${labelB}`, k, "", B.get(k)]);
    for (const k of beda) masalah.push([cat, "isi berbeda", k, A.get(k), B.get(k)]);

    const dizi = hanyaB.filter((k) => diizinkan.has(k.split(" :: ").pop()));
    ringkasan.push(
      `  ${cat.padEnd(17)} ${labelA}=${String(A.size).padStart(3)} ${labelB}=${String(B.size).padStart(3)}`
      + (A.size === B.size && !beda.length && !hanyaA.length && !takDiduga.length
        ? "   IDENTIK"
        : `   selisih: ${hanyaA.length}/${takDiduga.length}/${beda.length}`)
      + (dizi.length ? `   (+${dizi.length} diizinkan di ${labelB}: ${dizi.join(", ")})` : "")
    );
  }
  return { masalah, ringkasan };
}

function lapor(masalah, ringkasan, labelA, labelB) {
  console.log(`\n${labelA} vs ${labelB}`);
  console.log(ringkasan.join("\n"));
  if (!masalah.length) {
    console.log("\nHASIL: TIDAK ADA DRIFT tak terduga.");
    return 0;
  }
  console.log(`\nHASIL: ${masalah.length} SELISIH TAK TERDUGA`);
  for (const [cat, jenis, id, va, vb] of masalah) {
    console.log(`\n  [${cat}] ${jenis}: ${id}`);
    if (va) console.log(`    ${labelA}: ${va.slice(0, 300)}`);
    if (vb) console.log(`    ${labelB}: ${vb.slice(0, 300)}`);
  }
  console.log(
    "\nKalau selisih ini DISENGAJA, perbaiki sumbernya (sql/schema.sql atau"
    + " database live) lalu jalankan --check --update-snapshot. Jangan memperbarui"
    + " snapshot tanpa membaca diff-nya."
  );
  return 1;
}

function buatSnapshot(dir) {
  const dump = bacaDump(dir);
  const isi = {
    _meta: {
      keterangan:
        "Snapshot katalog hasil memasang sql/schema.sql dari nol. Dibangkitkan oleh "
        + "scripts/schema-verify/drift-check.mjs --snapshot. Nilainya sudah "
        + "dinormalkan (lihat hashBody/petakan di alat itu), jadi membandingkan "
        + "snapshot ini dengan dump baru tidak tergantung komentar, CRLF, atau "
        + "spasi berlebih.",
      dibangkitkan: new Date().toISOString().slice(0, 10),
      kategori: KATEGORI,
      diizinkan_hanya_di_live: DIHARAPKAN_HANYA_DI_LIVE,
    },
  };
  for (const cat of KATEGORI) {
    isi[cat] = [...petakan(cat, dump[cat]).entries()].map(([id, v]) => `${id}  ||  ${v}`).sort();
  }
  writeFileSync(SNAPSHOT, JSON.stringify(isi, null, 1) + "\n");
  console.log(`  snapshot ditulis: ${SNAPSHOT}`);
  for (const cat of KATEGORI) console.log(`    ${cat.padEnd(17)} ${isi[cat].length} entri`);
}

/**
 * Bandingkan sebuah dump katalog dengan expected-catalog.json yang ter-commit.
 *
 * @param {boolean} izinkanLiveOnly kalau true, entri yang terdaftar di
 *   DIHARAPKAN_HANYA_DI_LIVE tidak dianggap selisih. HANYA dipakai untuk
 *   --live-check: snapshot dibangkitkan dari pemasangan schema.sql (yang memang
 *   tidak memuat rls_auto_enable), jadi membandingkannya dengan produksi tanpa
 *   kelonggaran ini akan selalu melaporkan selisih palsu. Untuk --check (CI,
 *   referensi vs snapshot) kelonggaran ini SENGAJA tidak dipakai: kalau suatu
 *   saat rls_auto_enable diangkat ke schema.sql, snapshot-nya harus diperbarui
 *   secara sadar, bukan disembunyikan.
 */
function bandingkanDenganSnapshot(dir, label, izinkanLiveOnly = false) {
  if (!existsSync(SNAPSHOT)) {
    console.error(`expected-catalog.json belum ada. Jalankan --snapshot <dir> dulu.`);
    return 1;
  }
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const dump = bacaDump(dir);
  const masalah = [];
  const ringkasan = [];
  const idDari = (entri) => entri.split("  ||  ")[0];
  const diizinkan = (cat, entri) => {
    if (!izinkanLiveOnly) return false;
    const daftar = DIHARAPKAN_HANYA_DI_LIVE[cat] ?? [];
    const id = idDari(entri);
    return daftar.includes(id) || daftar.includes(id.split(" :: ").pop());
  };
  for (const cat of KATEGORI) {
    const kini = [...petakan(cat, dump[cat]).entries()].map(([id, v]) => `${id}  ||  ${v}`).sort();
    const harap = snap[cat] ?? [];
    const hanyaKini = kini.filter((x) => !harap.includes(x) && !diizinkan(cat, x));
    const hanyaHarap = harap.filter((x) => !kini.includes(x));
    const dizi = kini.filter((x) => !harap.includes(x) && diizinkan(cat, x));
    ringkasan.push(
      `  ${cat.padEnd(17)} snapshot=${String(harap.length).padStart(3)} ${label}=${String(kini.length).padStart(3)}`
      + (!hanyaKini.length && !hanyaHarap.length ? "   IDENTIK" : `   selisih ${hanyaKini.length + hanyaHarap.length}`)
      + (dizi.length ? `   (+${dizi.length} diizinkan: ${dizi.map(idDari).join(", ")})` : "")
    );
    for (const x of hanyaHarap) masalah.push([cat, `ada di snapshot, hilang di ${label}`, x]);
    for (const x of hanyaKini) masalah.push([cat, `baru di ${label}, tidak ada di snapshot`, x]);
  }
  console.log(`\nsnapshot (schema.sql ter-commit) vs ${label}`);
  console.log(ringkasan.join("\n"));
  if (!masalah.length) {
    console.log("\nHASIL: katalog cocok dengan snapshot.");
    return 0;
  }
  console.log(`\nHASIL: ${masalah.length} SELISIH terhadap snapshot`);
  for (const [cat, jenis, x] of masalah) console.log(`  [${cat}] ${jenis}\n    ${x.slice(0, 320)}`);
  return 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const ambil = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const TMP = resolve(HERE, ".tmp-drift");

async function main() {
  try {
    if (args.includes("--dump-psql")) {
      const dir = resolve(ambil("--dump-psql"));
      console.log("  membangun database referensi dari sql/schema.sql ...");
      const r = dumpViaPsql(dir);
      console.log("  " + Object.entries(r).map(([k, v]) => `${k}=${v}`).join("  "));
      return 0;
    }
    if (args.includes("--dump-live")) {
      const dir = resolve(ambil("--dump-live"));
      console.log("  mengambil katalog produksi (read-only) ...");
      const r = await dumpViaLive(dir);
      console.log("  " + Object.entries(r).map(([k, v]) => `${k}=${v}`).join("  "));
      return 0;
    }
    if (args.includes("--snapshot")) {
      buatSnapshot(resolve(ambil("--snapshot")));
      return 0;
    }
    if (args.includes("--compare")) {
      const i = args.indexOf("--compare");
      const a = resolve(args[i + 1]);
      const b = resolve(args[i + 2]);
      const { masalah, ringkasan } = bandingkan(bacaDump(a), bacaDump(b), "A", "B");
      return lapor(masalah, ringkasan, "A", "B");
    }
    if (args.includes("--live-check")) {
      rmSync(TMP, { recursive: true, force: true });
      await dumpViaLive(TMP);
      return bandingkanDenganSnapshot(TMP, "PRODUKSI", true);
    }
    if (args.includes("--check")) {
      rmSync(TMP, { recursive: true, force: true });
      console.log("  membangun database referensi dari sql/schema.sql ...");
      dumpViaPsql(TMP);
      if (args.includes("--update-snapshot")) {
        buatSnapshot(TMP);
        rmSync(TMP, { recursive: true, force: true });
        return 0;
      }
      const kode = bandingkanDenganSnapshot(TMP, "instalasi baru");
      rmSync(TMP, { recursive: true, force: true });
      return kode;
    }
    console.log(readFileSync(resolve(HERE, "drift-check.mjs"), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n"));
    return 2;
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
}

process.exit(await main());
