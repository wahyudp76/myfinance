// GUARD: sql/schema.sql WAJIB tetap jadi titik masuk instalasi yang LENGKAP.
//
// Latar (v95, 2026-09-07): schema.sql dulu cuma memuat 6 tabel inti -- TANPA
// satu pun RPC, tanpa api_rate_limits/platform_logos/whatsapp_*/rate_limits,
// dan tanpa kolom-kolom yang ditambahkan migrasi. Project Supabase baru yang
// dipasang dari file itu "hidup" tapi rusak begitu dipakai: Transfer, simpan
// Budget, Transaksi Berulang, dan rate limit Edge Function semuanya gagal.
// Menjalankan sql/migrations/* setelahnya juga tidak menyelamatkan (dua file
// migrasi ERROR di project baru; lihat header schema.sql).
//
// Test ini memastikan celah itu tidak pernah terbuka lagi:
//   1. setiap RPC yang dipanggil kode aplikasi ADA definisinya di schema.sql;
//   2. setiap tabel yang dibuat migrasi ADA juga di schema.sql;
//   3. setiap kolom yang ditambahkan migrasi ADA di schema.sql;
//   4. body function di schema.sql PERSIS SAMA dengan migrasi kanoniknya
//      (kalau salah satunya diubah tanpa yang lain -> merah);
//   5. policy di schema.sql memakai bentuk initplan `(select auth.uid())`
//      -- sama dengan database live (migrations/rls_performance_fix.sql).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const schema = readFileSync(resolve(ROOT, "sql/schema.sql"), "utf8");

const MIGRATION_DIR = resolve(ROOT, "sql/migrations");
const migrationFiles = readdirSync(MIGRATION_DIR).filter((f) => f.endsWith(".sql"));

// Sumber kode yang boleh memanggil RPC.
const CODE_FILES = [
  "app.src.js",
  "index.html",
  ...walk("src"),
  ...walk("supabase/functions"),
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.(js|mjs|ts)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Ambil teks definisi satu function, dari `create or replace function` sampai `$$;`. */
function extractFunction(sql, name) {
  const head = `create or replace function public.${name}(`;
  const start = sql.indexOf(head);
  if (start === -1) return null;
  const end = sql.indexOf("\n$$;", start);
  if (end === -1) return null;
  return sql.slice(start, end + "\n$$;".length);
}

/** Samakan spasi ekor & akhir baris supaya perbandingan fokus ke isi. */
const normalize = (s) => s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();

// Definisi kanonik tiap RPC. Kalau suatu saat sebuah RPC dipindah/diubah,
// perbarui peta ini bersama schema.sql.
const CANONICAL_FUNCTIONS = {
  check_and_consume_rate_limit: "migration_rate_limiting_2026-08.sql",
  create_transfer_transaction: "migration_transfer_currency_2026-08.sql",
  create_recurring_transaction: "migration_reliability_hardening_2026-08.sql",
  replace_month_budgets: "migration_reliability_hardening_2026-08.sql",
};

test("schema.sql: semua RPC yang dipanggil kode punya definisi", () => {
  const used = new Set();
  for (const file of CODE_FILES) {
    const src = readFileSync(resolve(ROOT, file), "utf8");
    for (const m of src.matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/gi)) used.add(m[1]);
  }

  assert.ok(used.size >= 4, `deteksi RPC gagal (cuma ${used.size}) -- regex-nya rusak?`);

  for (const name of used) {
    assert.ok(
      extractFunction(schema, name),
      `RPC "${name}" dipanggil kode aplikasi tapi TIDAK didefinisikan di sql/schema.sql. ` +
      `Instalasi baru akan gagal saat fitur itu dipakai -- tambahkan definisinya ke schema.sql.`
    );
  }
});

test("schema.sql: body RPC identik dengan migrasi kanoniknya (anti-drift)", () => {
  for (const [name, migration] of Object.entries(CANONICAL_FUNCTIONS)) {
    const canonSrc = readFileSync(resolve(MIGRATION_DIR, migration), "utf8");
    const canonical = extractFunction(canonSrc, name);
    const inSchema = extractFunction(schema, name);

    assert.ok(canonical, `definisi kanonik "${name}" tidak ketemu di migrations/${migration}`);
    assert.ok(inSchema, `definisi "${name}" tidak ketemu di sql/schema.sql`);
    assert.equal(
      normalize(inSchema),
      normalize(canonical),
      `Definisi "${name}" di sql/schema.sql BERBEDA dengan migrations/${migration}. ` +
      `Keduanya harus disalin persis -- perbarui yang tertinggal.`
    );
  }
});

test("schema.sql: semua tabel yang dibuat migrasi ikut ada", () => {
  // rate_limits (warisan) tidak pernah dibuat file migrasi mana pun -- lahir
  // langsung di DB live; sejak v95 didefinisikan di schema.sql (bagian 7b).
  const tablesInSchema = new Set(
    [...schema.matchAll(/create table if not exists (?:public\.)?([a-z0-9_]+)/gi)].map((m) => m[1])
  );

  for (const file of migrationFiles) {
    const src = readFileSync(resolve(MIGRATION_DIR, file), "utf8");
    for (const m of src.matchAll(/^create table if not exists (?:public\.)?([a-z0-9_]+)/gim)) {
      assert.ok(
        tablesInSchema.has(m[1]),
        `Tabel "${m[1]}" dibuat migrations/${file} tapi tidak ada di sql/schema.sql -- ` +
        `instalasi baru akan kehilangan tabel itu.`
      );
    }
  }

  assert.ok(tablesInSchema.has("rate_limits"), "rate_limits (warisan, dipakai analyze-finance) hilang dari schema.sql");
  assert.ok(tablesInSchema.has("api_rate_limits"), "api_rate_limits hilang dari schema.sql");
});

test("schema.sql: semua kolom yang ditambahkan migrasi ikut ada", () => {
  for (const file of migrationFiles) {
    const src = readFileSync(resolve(MIGRATION_DIR, file), "utf8");
    // Bentuk 1 baris DAN bentuk multi-baris (alter table \n add column ...).
    const re = /alter table\s+(?:public\.)?([a-z0-9_]+)\s+add column if not exists\s+([a-z0-9_]+)/gis;
    for (const m of src.matchAll(re)) {
      const [, table, column] = m;
      // platform_logos di migrasinya dibentuk lewat alter-add-column; di
      // schema.sql kolomnya inline di create table -- cukup cek namanya ada.
      const inSchema = new RegExp(`\\b${column}\\b`).test(schema);
      assert.ok(
        inSchema,
        `Kolom "${table}.${column}" ditambahkan migrations/${file} tapi tidak ada di sql/schema.sql.`
      );
    }
  }
});

test("schema.sql: policy memakai bentuk initplan (select auth.uid())", () => {
  // auth.uid() polos di dalam policy = dievaluasi per BARIS (lint Supabase
  // auth_rls_initplan). Yang boleh polos hanya `default auth.uid()` di kolom.
  const policyBlocks = schema.match(/create policy[\s\S]*?;/gi) ?? [];
  assert.ok(policyBlocks.length >= 14, `policy terdeteksi cuma ${policyBlocks.length} -- parser rusak?`);

  for (const block of policyBlocks) {
    const bare = block.replace(/\(select auth\.uid\(\)\)/g, "").includes("auth.uid()");
    assert.ok(
      !bare,
      `Policy memakai auth.uid() polos (harus (select auth.uid())):\n${block.slice(0, 160)}`
    );
  }
});
