// VERIFY DATA PARITY — kebenaran data antara Postgres (skema & RLS asli) dan web.
//
// KENAPA ADA (audit data 2026-10-21): selama ini kebenaran angka di web hanya
// dibuktikan dua cara — unit test dengan data karangan (tanpa database), dan
// uji parity LIVE yang otomatis SKIP tanpa SUPABASE_URL/SUPABASE_ANON_KEY
// (lihat tests/parity/transactions-live.test.js). Artinya di CI tidak ada satu
// pun bukti bahwa angka yang dihitung web sama dengan angka yang dikatakan
// database. Harness ini menutup lubang itu secara HERMETIK: PostgreSQL lokal +
// scripts/schema-verify/supabase-shim.sql + sql/schema.sql asli, RLS AKTIF
// (set role authenticated + request.uid), lalu:
//
//   1. isolasi   : baris user lain tidak bocor ke user ini
//   2. baris     : setiap baris yang dibaca, setelah lewat mapTransactionRow()
//                  (normalisasi klien), nilainya sama dengan kata SQL
//   3. valuta    : jumlah_idr hasil kali kurs di DB == yang dipakai klien
//   4. agregat   : totalIn/totalOut, monthIn/monthOut/monthTxCount,
//                  pengeluaran per kategori, ringkasan per bulan, dan saldo per
//                  akun — dihitung SQL vs dihitung src/domain/dashboard.js
//   5. transfer  : tidak ikut monthIn/monthOut di kedua sisi
//
// Jalankan: node scripts/verify-data-parity.mjs
//   env: PGHOST PGPORT PGUSER PGPASSWORD (default 127.0.0.1:5432 postgres/postgres)
//        PARITY_DB (default datparity)
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { mapTransactionRow } from "../src/services/transactions.js";
import { aggregateDashboardData } from "../src/domain/dashboard.js";
import { txIdrAmount } from "../src/domain/format.js";
import { parseTgl } from "../src/domain/dates.js";

const ROOT = resolve(import.meta.dirname, "..");
const DB = process.env.PARITY_DB || "datparity";
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

let gagal = 0;
const ok = (kondisi, label, extra = "") => {
  if (!kondisi) gagal += 1;
  console.log(`${kondisi ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
};
const hampir = (a, b, eps = 0.5) => Math.abs(Number(a) - Number(b)) <= eps;

function psql(sql, { db = "postgres", asUser = null } = {}) {
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-d", db, "-c", sql];
  const env = { ...process.env };
  if (asUser) {
    // Simulasi JWT Supabase: role authenticated + GUC request.uid (pola yang sama
    // dengan scripts/schema-verify/functional-check.sql).
    env.PGOPTIONS = `-c role=authenticated -c request.uid=${asUser} -c request.role=authenticated`;
  }
  return execFileSync("psql", args, { env, encoding: "utf8" });
}
const psqlJson = (sql, opt) => JSON.parse(psql(sql, opt).trim() || "null");

// ---------------------------------------------------------------------------
// 1. Database bersih + skema asli
// ---------------------------------------------------------------------------
execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", `drop database if exists ${DB}`], { encoding: "utf8" });
execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", `create database ${DB}`], { encoding: "utf8" });
for (const f of ["scripts/schema-verify/supabase-shim.sql", "sql/schema.sql"]) {
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", join(ROOT, f)], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
}
// Meniru grant default Supabase (persis scripts/schema-verify/functional-check.sql
// baris 19-21): di Supabase role anon/authenticated otomatis punya privilege atas
// tabel di schema public lewat ALTER DEFAULT PRIVILEGES, bukan dari schema.sql.
psql(`grant usage on schema public to anon, authenticated, service_role;
      grant all on all tables in schema public to authenticated;
      grant all on all sequences in schema public to authenticated;`, { db: DB });
console.log(`-- database ${DB}: shim + sql/schema.sql + grant default terpasang`);

// ---------------------------------------------------------------------------
// 2. Data uji (deterministik) — sengaja mencakup kasus yang paling sering bikin
//    angka web melenceng: valuta asing + kurs, tanggal di awal/akhir bulan,
//    transaksi bulan lalu & 2 bulan lalu, transfer antar akun, dan baris milik
//    user lain.
// ---------------------------------------------------------------------------
const now = new Date();
const ym = (offset) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
};
const tgl = (offset, hari) => {
  const { y, m } = ym(offset);
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(hari, lastDay)).padStart(2, "0")}`;
};
const KURS_USD = 16250;
// [id, user, tanggal, jenis, kategori, akun, jumlah, mata_uang, kurs]
const baris = [
  ["p1", U1, tgl(0, 1), "Pemasukan", "Gaji", "BCA", "8000000", null, null],
  ["p2", U1, tgl(0, 5), "Pengeluaran", "Makanan & Minuman", "BCA", "250000", null, null],
  ["p3", U1, tgl(0, 5), "Pengeluaran", "Makanan & Minuman", "GoPay", "75500", null, null],
  ["p4", U1, tgl(0, 12), "Pengeluaran", "Transportasi", "GoPay", "48000", null, null],
  // valuta asing: jumlah 120.50 USD x 16.250 = 1.958.125 (bukan bilangan bulat "cantik")
  ["p5", U1, tgl(0, 12), "Pengeluaran", "Belanja", "BCA", "120.50", "USD", String(KURS_USD)],
  ["p6", U1, tgl(0, 20), "Pemasukan", "Freelance", "BCA", "350.25", "USD", String(KURS_USD)],
  ["p7", U1, tgl(0, 28), "Transfer", "GoPay", "BCA", "500000", null, null],
  // bulan lalu & dua bulan lalu (untuk monthlyMap + prevMonth)
  ["p8", U1, tgl(-1, 3), "Pemasukan", "Gaji", "BCA", "8000000", null, null],
  ["p9", U1, tgl(-1, 15), "Pengeluaran", "Makanan & Minuman", "BCA", "1200000", null, null],
  ["p10", U1, tgl(-2, 9), "Pengeluaran", "Transportasi", "BCA", "300000", null, null],
  // milik user lain -- HARUS tidak terlihat oleh U1
  ["x1", U2, tgl(0, 6), "Pengeluaran", "Makanan & Minuman", "BCA", "999999", null, null],
  ["x2", U2, tgl(0, 7), "Pemasukan", "Gaji", "BCA", "7777777", null, null],
];
// UUID deterministik yang sah (grup pertama wajib 8 karakter heksadesimal).
const uuidFor = (i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`;
const values = baris.map(([id, u, t, j, k, a, n, mu, kurs], i) =>
  `('${uuidFor(i)}'::uuid,'${u}'::uuid,'${t}','${j}','${k.replace(/'/g, "''")}','${a}',${n}${mu ? `,'${mu}'` : ",null"}${kurs ? `,${kurs}` : ",null"}${kurs ? `,${Math.round(Number(n) * Number(kurs))}` : `,${n}`},'${id}')`
).join(",");
// transactions.user_id punya FK ke auth.users (dibuat shim), jadi kedua user
// harus ada lebih dulu -- persis kondisi nyata di Supabase.
psql(`insert into auth.users (id, email) values ('${U1}','u1@parity.test'), ('${U2}','u2@parity.test')`, { db: DB });
psql(
  `insert into transactions (id, user_id, tanggal, jenis, kategori, akun, jumlah, mata_uang, kurs, jumlah_idr, keterangan)
   values ${values}`,
  { db: DB },
);
console.log(`-- ${baris.length} baris di-seed (2 di antaranya milik user lain)`);

// ---------------------------------------------------------------------------
// 3. KEBENARAN MENURUT SQL
// ---------------------------------------------------------------------------
const bulanIniAwal = tgl(0, 1);
const { y: yB, m: mB } = ym(1);
const bulanDepanAwal = `${yB}-${String(mB).padStart(2, "0")}-01`;
const sqlUmum = `user_id = '${U1}'::uuid`;
const sqlBulanIni = `${sqlUmum} and tanggal >= '${bulanIniAwal}' and tanggal < '${bulanDepanAwal}'`;

const sqlTotal = psqlJson(
  `select row_to_json(r) from (
     select coalesce(sum(jumlah_idr) filter (where jenis='Pemasukan'),0)::float8 as total_in,
            coalesce(sum(jumlah_idr) filter (where jenis='Pengeluaran'),0)::float8 as total_out,
            count(*)::int as n
     from transactions where ${sqlUmum}) r`, { db: DB });
const sqlBulan = psqlJson(
  `select row_to_json(r) from (
     select coalesce(sum(jumlah_idr) filter (where jenis='Pemasukan'),0)::float8 as in_,
            coalesce(sum(jumlah_idr) filter (where jenis='Pengeluaran'),0)::float8 as out_,
            coalesce(count(*) filter (where jenis <> 'Transfer'),0)::int as n_tx
     from transactions where ${sqlBulanIni}) r`, { db: DB });
const sqlPerKategori = psqlJson(
  `select coalesce(json_object_agg(kategori, total), '{}') as m from
     (select kategori, sum(jumlah_idr)::float8 as total from transactions
      where ${sqlBulanIni} and jenis='Pengeluaran' group by kategori) s`, { db: DB });
const sqlPerBulan = psqlJson(
  `select coalesce(json_object_agg(ym, row_to_json(r)), '{}') as m from
     (select to_char(tanggal,'YYYY-MM') as ym,
             coalesce(sum(jumlah_idr) filter (where jenis='Pemasukan'),0)::float8 as in_,
             coalesce(sum(jumlah_idr) filter (where jenis='Pengeluaran'),0)::float8 as out_
      from transactions where ${sqlUmum} group by 1) r`, { db: DB });
// PENTING: saldo akun dihitung dalam MATA UANG AKUN ITU SENDIRI (`jumlah`),
// bukan `jumlah_idr` -- itu kontrak yang tertulis di src/domain/dashboard.js
// ("amt = NATIVE ... dipakai HANYA utk saldo per-akun"). Sisi tujuan transfer
// ikut menambah akun yang namanya ada di kolom `kategori`.
const sqlSaldo = psqlJson(
  `select coalesce(json_object_agg(akun, saldo), '{}') from
     (select akun, sum(delta)::float8 as saldo from (
        select akun, case when jenis='Pemasukan' then jumlah else -jumlah end as delta
          from transactions where ${sqlUmum}
        union all
        select kategori as akun, jumlah as delta
          from transactions where ${sqlUmum} and jenis='Transfer'
      ) g group by akun) s`, { db: DB });

// ---------------------------------------------------------------------------
// 4. APA YANG DILIHAT & DIHITUNG WEB (RLS aktif, normalisasi klien)
// ---------------------------------------------------------------------------
const barisU1 = psqlJson(
  `select coalesce(json_agg(row_to_json(t) order by created_at), '[]') from
     (select * from transactions) t`, { db: DB, asUser: U1 });
const barisU2 = psqlJson(
  `select coalesce(json_agg(row_to_json(t) order by created_at), '[]') from
     (select * from transactions) t`, { db: DB, asUser: U2 });
const ternormalisasi = barisU1.map(mapTransactionRow);
const akun = [...new Set(baris.map((b) => b[5]))];
const agregat = aggregateDashboardData(ternormalisasi, {
  accounts: akun,
  assets: [],
  now,
  txIdrAmount,
  // Transfer di data uji semuanya IDR->IDR, jadi nominal tujuan = jumlah_idr.
  transferTargetAmount: (d) => txIdrAmount(d),
  parseTgl,
  // Kategori uji sengaja nama kategori UTAMA, jadi parent = namanya sendiri.
  categorizeExpenseParent: (nama) => nama,
});

// ---------------------------------------------------------------------------
// 5. PERBANDINGAN
// ---------------------------------------------------------------------------
console.log("\n-- isolasi antar pengguna (RLS) --");
ok(barisU1.length === 10, "web hanya melihat 10 baris milik U1", `dibaca ${barisU1.length}`);
ok(barisU1.every((r) => r.user_id === U1), "tidak ada baris user lain yang bocor ke U1");
ok(barisU2.length === 2 && barisU2.every((r) => r.user_id === U2), "U2 hanya melihat 2 barisnya sendiri", `dibaca ${barisU2.length}`);

console.log("\n-- tingkat baris (normalisasi klien vs SQL) --");
const salahBaris = [];
for (const [i, asal] of barisU1.entries()) {
  const n = ternormalisasi[i];
  const exp = baris.find((b) => asal.keterangan === b[0]);
  const expIdr = exp[8] ? Math.round(Number(exp[6]) * Number(exp[8])) : Number(exp[6]);
  if (String(n.tanggal).slice(0, 10) !== exp[2]) salahBaris.push(`${exp[0]}:tanggal ${n.tanggal}!=${exp[2]}`);
  if (!hampir(txIdrAmount(n), expIdr, 0.01)) salahBaris.push(`${exp[0]}:jumlah_idr ${txIdrAmount(n)}!=${expIdr}`);
  if (n.jenis !== exp[3]) salahBaris.push(`${exp[0]}:jenis`);
}
ok(salahBaris.length === 0, "tanggal/jenis/jumlah_idr tiap baris cocok dengan SQL", salahBaris.join(", ") || `${barisU1.length} baris cocok`);
const usd = ternormalisasi.find((r) => r.keterangan === "p5");
ok(hampir(txIdrAmount(usd), 120.5 * KURS_USD, 0.01), "valuta asing: 120,50 USD x 16.250 = 1.958.125", `klien ${txIdrAmount(usd)}`);

console.log("\n-- agregat: SQL vs src/domain/dashboard.js --");
ok(hampir(agregat.totalIn, sqlTotal.total_in), "totalIn (semua waktu)", `SQL ${sqlTotal.total_in} | web ${agregat.totalIn}`);
ok(hampir(agregat.totalOut, sqlTotal.total_out), "totalOut (semua waktu)", `SQL ${sqlTotal.total_out} | web ${agregat.totalOut}`);
ok(hampir(agregat.monthIn, sqlBulan.in_), "monthIn (bulan berjalan)", `SQL ${sqlBulan.in_} | web ${agregat.monthIn}`);
ok(hampir(agregat.monthOut, sqlBulan.out_), "monthOut (bulan berjalan)", `SQL ${sqlBulan.out_} | web ${agregat.monthOut}`);
ok(agregat.monthTxCount === sqlBulan.n_tx, "monthTxCount mengecualikan Transfer", `SQL ${sqlBulan.n_tx} | web ${agregat.monthTxCount}`);

const kunciKat = new Set([...Object.keys(sqlPerKategori), ...Object.keys(agregat.monthCatOutMap)]);
const bedaKat = [...kunciKat].filter((k) => !hampir(agregat.monthCatOutMap[k] || 0, sqlPerKategori[k] || 0));
ok(bedaKat.length === 0, "pengeluaran per kategori bulan ini identik", bedaKat.map((k) => `${k}: SQL ${sqlPerKategori[k]} vs web ${agregat.monthCatOutMap[k]}`).join("; ") || `${kunciKat.size} kategori cocok`);

// monthlyMap klien berkunci LABEL bulan ("Okt 2026"), bukan "YYYY-MM" -- jadi
// kunci SQL diterjemahkan lebih dulu supaya yang dibandingkan adalah ANGKANYA.
const labelBulan = (ymStr) => {
  const [y, m] = ymStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("id-ID", { month: "short", year: "numeric" });
};
const sqlPerBulanLabel = Object.fromEntries(Object.entries(sqlPerBulan).map(([k, v]) => [labelBulan(k), v]));
const kunciBulan = new Set([...Object.keys(sqlPerBulanLabel), ...Object.keys(agregat.monthlyMap)]);
const bedaBulan = [...kunciBulan].filter((k) => {
  const s = sqlPerBulanLabel[k] || { in_: 0, out_: 0 };
  const w = agregat.monthlyMap[k] || { in: 0, out: 0 };
  return !hampir(w.in, s.in_) || !hampir(w.out, s.out_);
});
ok(bedaBulan.length === 0, "ringkasan per bulan identik", bedaBulan.map((k) => `${k}: SQL ${JSON.stringify(sqlPerBulanLabel[k])} vs web ${JSON.stringify(agregat.monthlyMap[k])}`).join("; ") || `${kunciBulan.size} bulan cocok`);

const bedaSaldo = Object.keys(sqlSaldo).filter((k) => !hampir(agregat.accBalances?.[k] ?? 0, sqlSaldo[k]));
ok(bedaSaldo.length === 0, "saldo per akun identik", bedaSaldo.map((k) => `${k}: SQL ${sqlSaldo[k]} vs web ${agregat.accBalances?.[k]}`).join("; ") || `${Object.keys(sqlSaldo).length} akun cocok`);

console.log("\n-- transfer tidak boleh masuk pemasukan/pengeluaran bulan ini --");
const sqlTanpaTransfer = psqlJson(
  `select row_to_json(r) from (
     select coalesce(sum(jumlah_idr) filter (where jenis='Transfer'),0)::float8 as t
     from transactions where ${sqlBulanIni}) r`, { db: DB }).t;
ok(sqlTanpaTransfer > 0, "data uji memang punya transfer bulan ini", `Rp ${sqlTanpaTransfer}`);
ok(!hampir(agregat.monthIn, sqlBulan.in_ + sqlTanpaTransfer), "monthIn web tidak memasukkan transfer");
ok(!hampir(agregat.monthOut, sqlBulan.out_ + sqlTanpaTransfer), "monthOut web tidak memasukkan transfer");

console.log("\n-- kontrak mata uang (regresi yang mudah terjadi diam-diam) --");
const saldoIdrBca = Object.values(barisU1)
  .filter((r) => r.akun === "BCA")
  .reduce((a, r) => a + (r.jenis === "Pemasukan" ? 1 : -1) * txIdrAmount(mapTransactionRow(r)), 0)
  - 500000;
ok(!hampir(agregat.accBalances.BCA, saldoIdrBca, 1),
  "saldo akun TIDAK memakai jumlah_idr (melainkan mata uang akun)",
  `saldo web ${agregat.accBalances.BCA} vs ekuivalen IDR ${saldoIdrBca}`);
ok(hampir(agregat.accBalances.BCA, sqlSaldo.BCA), "saldo BCA = kata SQL (mata uang akun)", `SQL ${sqlSaldo.BCA} | web ${agregat.accBalances.BCA}`);

// ---------------------------------------------------------------------------
// 6. DATA KOTOR — baris cacat warisan versi lama (angka sebagai teks, tanggal
//    kosong, jenis tak dikenal). Web tidak boleh melempar exception maupun
//    menghasilkan NaN: satu baris rusak pernah cukup untuk mengosongkan
//    seluruh dashboard.
// ---------------------------------------------------------------------------
console.log("\n-- data kotor (web harus tahan, bukan menghasilkan NaN) --");
const kotor = [
  { id: "k1", tanggal: tgl(0, 2), jenis: "Pemasukan", kategori: "Gaji", akun: "BCA", jumlah: "1500000", jumlah_idr: null, created_at: `${tgl(0, 2)}T01:00:00Z`, keterangan: "angka sebagai teks, jumlah_idr null" },
  { id: "k2", tanggal: null, jenis: "Pengeluaran", kategori: "Belanja", akun: "BCA", jumlah: 50000, jumlah_idr: 50000, created_at: `${tgl(0, 2)}T02:00:00Z`, keterangan: "tanggal kosong" },
  { id: "k3", tanggal: tgl(0, 3), jenis: "pemasukan", kategori: "Gaji", akun: "BCA", jumlah: 10000, jumlah_idr: 10000, created_at: `${tgl(0, 3)}T03:00:00Z`, keterangan: "jenis huruf kecil" },
  { id: "k4", tanggal: tgl(0, 4), jenis: "Pengeluaran", kategori: "Belanja", akun: "BCA", jumlah: "bukan angka", jumlah_idr: "bukan angka", created_at: `${tgl(0, 4)}T04:00:00Z`, keterangan: "jumlah bukan angka" },
];
let hasilKotor = null;
let lempar = null;
try {
  hasilKotor = aggregateDashboardData(kotor.map(mapTransactionRow), {
    accounts: ["BCA"], assets: [], now, txIdrAmount,
    transferTargetAmount: (d) => txIdrAmount(d), parseTgl,
    categorizeExpenseParent: (n) => n,
  });
} catch (e) { lempar = String(e).slice(0, 120); }
ok(lempar === null, "data kotor tidak melempar exception", lempar || "aman");
const nan = hasilKotor
  ? Object.entries(hasilKotor).filter(([, v]) => typeof v === "number" && Number.isNaN(v)).map(([nama]) => nama)
  : ["(tidak ada hasil)"];
ok(nan.length === 0, "tidak ada agregat bernilai NaN", nan.join(", ") || "bersih");
ok(hasilKotor && hampir(hasilKotor.totalIn, 1500000), "angka sebagai teks + jumlah_idr null tetap terbaca (fallback ke jumlah)", `totalIn ${hasilKotor && hasilKotor.totalIn}`);

console.log(gagal === 0 ? "\nSEMUA CEK LOLOS" : `\n${gagal} CEK GAGAL`);
process.exit(gagal === 0 ? 0 : 1);
