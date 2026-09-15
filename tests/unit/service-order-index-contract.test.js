// GUARD: urutan ORDER BY service Supabase == prefix index komposit di schema.
//
// KENAPA ADA (v127, audit performa load & sync 2026-09-15):
// src/services/transactions.js mengurutkan hasil list() dengan
//     order("tanggal", desc) -> order("created_at", desc) -> order("id", asc)
// tetapi index komposit yang ada di sql/schema.sql hanya
//     (user_id, tanggal desc, id asc)
// -- created_at disisipkan ke urutan query SETELAH index itu dibuat, dan tidak
// ada satu pun penjaga yang menyadarinya. Akibatnya planner Postgres menambahkan
// node "Incremental Sort" di SETIAP halaman tarikan transaksi (tarikan penuh
// terjadi tiap buka app / pull-to-refresh / refresh pasca-CRUD). Terukur di
// PostgreSQL 17: 216,8 ms -> 79,6 ms untuk satu tarikan 20.000 baris setelah
// index (user_id, tanggal desc, created_at desc, id asc) dibuat -- bukti lengkap
// ada di sql/migrations/migration_tx_order_index_2026-09-15.sql.
//
// Kelas bug ini murah dicegah dan mahal disadari (tidak ada error, hanya makin
// lambat), jadi test di bawah membandingkan kedua sisi secara mekanis untuk
// KETIGA tabel yang ditarik penuh oleh aplikasi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const baca = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

/**
 * Ambil urutan `.order(...)` dari blok query list() sebuah service.
 * Blok dibatasi dari `.from("<tabel>")` sampai `.range(` (kontrak paging bersama
 * src/services/supabase/paging.js: semua query list berakhir di .range).
 * @returns {{kolom: string, arah: "asc"|"desc"}[]}
 */
function urutanOrderBy(source, tabel) {
  const dari = source.indexOf(`.from("${tabel}")`);
  assert.notEqual(dari, -1, `tabel "${tabel}" tidak ditemukan di sumber service`);
  const range = source.indexOf(".range(", dari);
  assert.notEqual(range, -1, `blok list() "${tabel}" tidak punya .range( -- pola paging berubah?`);
  const blok = source.slice(dari, range);

  const urutan = [];
  const re = /\.order\(\s*"([^"]+)"\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
  let m;
  while ((m = re.exec(blok)) !== null) {
    const opsi = m[2] || "";
    const naik = /ascending:\s*false/.test(opsi) ? "desc" : "asc";
    urutan.push({ kolom: m[1], arah: naik });
  }
  return urutan;
}

/**
 * Ambil semua index untuk satu tabel dari schema.sql.
 * @returns {{nama: string, kolom: {kolom: string, arah: "asc"|"desc"}[]}[]}
 */
function indexTabel(schemaSql, tabel) {
  const hasil = [];
  const re = new RegExp(`create index if not exists (\\w+)\\s+on public\\.${tabel}\\s*\\(([^)]+)\\)`, "g");
  let m;
  while ((m = re.exec(schemaSql)) !== null) {
    const kolom = m[2].split(",").map((bagian) => {
      const token = bagian.trim().split(/\s+/);
      const arah = /desc/i.test(token[1] || "") ? "desc" : "asc";
      return { kolom: token[0], arah };
    });
    hasil.push({ nama: m[1], kolom });
  }
  return hasil;
}

/**
 * Apakah ada index yang meng-cover urutan ORDER BY itu?
 * Syarat: index diawali user_id (kolom filter RLS), lalu MEMUAT seluruh kolom
 * urutan dengan arah yang sama dan berurutan -- kolom tambahan di belakang
 * diperbolehkan (index tetap bisa dipakai sampai kedalaman urutan).
 */
function adaIndexPengcover(indexes, urutan) {
  return indexes.some((idx) => {
    const kolom = idx.kolom;
    if (kolom.length < urutan.length + 1) return false;
    if (kolom[0].kolom !== "user_id") return false;
    return urutan.every((u, i) => kolom[i + 1].kolom === u.kolom && kolom[i + 1].arah === u.arah);
  });
}

const TABEL = [
  { tabel: "transactions", service: "src/services/transactions.js" },
  { tabel: "assets", service: "src/services/supabase/assets.js" },
  { tabel: "recurring_transactions", service: "src/services/supabase/recurring.js" },
];

test("parser urutan ORDER BY membaca kolom + arah dengan benar", () => {
  const sumber = `
    supabase.from("contoh")
      .select("id")
      .order("tanggal", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  `;
  assert.deepEqual(urutanOrderBy(sumber, "contoh"), [
    { kolom: "tanggal", arah: "desc" },
    { kolom: "created_at", arah: "desc" },
    { kolom: "id", arah: "asc" },
  ]);
});

test("parser index membaca nama, kolom, dan arah dari schema.sql", () => {
  const schema = `
    create index if not exists idx_a
        on public.contoh (user_id, tanggal desc, id asc);
    create index if not exists idx_b on public.contoh (user_id);
    create index if not exists idx_lain on public.tabel_lain (user_id, x desc);
  `;
  const hasil = indexTabel(schema, "contoh");
  assert.deepEqual(hasil.map((i) => i.nama), ["idx_a", "idx_b"]);
  assert.deepEqual(hasil[0].kolom, [
    { kolom: "user_id", arah: "asc" },
    { kolom: "tanggal", arah: "desc" },
    { kolom: "id", arah: "asc" },
  ]);
});

test("kontrol negatif: pencocok index MENOLAK urutan yang tidak ter-cover", () => {
  // Inilah persis regresi v127: index (user_id, tanggal desc, id asc) TIDAK
  // meng-cover urutan (tanggal desc, created_at desc, id asc).
  const urutan = [
    { kolom: "tanggal", arah: "desc" },
    { kolom: "created_at", arah: "desc" },
    { kolom: "id", arah: "asc" },
  ];
  const indexLama = indexTabel(
    "create index if not exists x on public.transactions (user_id, tanggal desc, id asc);",
    "transactions",
  );
  assert.equal(adaIndexPengcover(indexLama, urutan), false,
    "kontrol negatif gagal: index lama seharusnya TIDAK dianggap meng-cover urutan baru");

  const indexBaru = indexTabel(
    "create index if not exists y on public.transactions (user_id, tanggal desc, created_at desc, id asc);",
    "transactions",
  );
  assert.equal(adaIndexPengcover(indexBaru, urutan), true);
});

for (const { tabel, service } of TABEL) {
  test(`ORDER BY list() ${tabel} ter-cover index komposit di sql/schema.sql`, () => {
    const urutan = urutanOrderBy(baca(service), tabel);
    assert.ok(urutan.length >= 2,
      `${service}: urutan list() diharapkan punya >= 2 kolom ORDER BY (dapat ${urutan.length})`);
    const indexes = indexTabel(baca("sql/schema.sql"), tabel);
    assert.ok(indexes.length > 0, `sql/schema.sql tidak punya index untuk public.${tabel}`);
    assert.ok(
      adaIndexPengcover(indexes, urutan),
      `${service} mengurutkan (${urutan.map((u) => `${u.kolom} ${u.arah}`).join(", ")}) `
      + `tetapi tidak ada index public.${tabel} yang diawali user_id lalu kolom urutan itu. `
      + `Index yang ada: ${indexes.map((i) => `${i.nama}(${i.kolom.map((k) => `${k.kolom} ${k.arah}`).join(", ")})`).join("; ")}. `
      + "Planner akan menambah node Sort di setiap tarikan -- tambahkan index komposit yang cocok "
      + "(lihat sql/migrations/migration_tx_order_index_2026-09-15.sql untuk contoh + bukti EXPLAIN).",
    );
  });
}
