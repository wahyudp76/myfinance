// Tier-3 #9: domain command palette (indeks + pencarian berperingkat).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommandIndex, searchCommands, PALETTE_TYPE } from "../../src/domain/command-palette.js";

const views = [{ name: "dashboard", label: "Dashboard" }, { name: "budget", label: "Budget" }, { name: "kalender", label: "Kalender" }];
const categoryDict = {
  pengeluaran: { "Makanan & Minuman": { icon: "fa-hamburger", subs: [] }, Transportasi: { icon: "fa-bus", subs: [] } },
  pemasukan: { Gaji: { icon: "fa-money-bill-wave", subs: [] } },
};
const idx = buildCommandIndex({
  views,
  categoryDict,
  accounts: ["Bank BCA", "GoPay"],
  transactions: [{ id: 1, tanggal: "2026-08-20", kategori: "Restoran", akun: "GoPay", keterangan: "Makan siang", jenis: "Pengeluaran" }],
});

test("buildCommandIndex: gabung views + kategori(parents) + akun + transaksi", () => {
  assert.equal(idx.filter((c) => c.type === "view").length, 3);
  assert.equal(idx.filter((c) => c.type === "category").length, 3);
  assert.equal(idx.filter((c) => c.type === "account").length, 2);
  assert.equal(idx.filter((c) => c.type === "transaction").length, 1);
  const gaji = idx.find((c) => c.label === "Gaji");
  assert.equal(gaji.jenis, "Pemasukan");
  const makan = idx.find((c) => c.label === "Makanan & Minuman");
  assert.equal(makan.jenis, "Pengeluaran");
});

test("searchCommands: query kosong -> hanya navigasi", () => {
  const r = searchCommands(idx, "");
  assert.equal(r.length, 3);
  assert.ok(r.every((c) => c.type === PALETTE_TYPE.VIEW));
  assert.equal(r[0].label, "Dashboard");
});

test("searchCommands: awalan dicocokkan; seri stabil by urutan indeks; limit", () => {
  const r = searchCommands(idx, "bu");
  assert.deepEqual(r.map((c) => c.label), ["Budget"]); // hanya Budget (awalan 'bu')
  const bank = searchCommands(idx, "bank");
  assert.ok(bank.some((c) => c.label === "Bank BCA"));
  const r2 = searchCommands(idx, "makan"); // seri skor-3: kategori (order lebih awal) menang
  assert.equal(r2[0].label, "Makanan & Minuman");
  assert.ok(r2.some((c) => c.label === "Makan siang"));
  const lim = searchCommands(idx, "a", { limit: 3 });
  assert.equal(lim.length, 3);
});

test("searchCommands: transaksi ketemu via akun/kategori di searchText", () => {
  const r = searchCommands(idx, "gopay");
  assert.ok(r.some((c) => c.type === "transaction" && c.label === "Makan siang"));
});

test("searchCommands: tidak ada hasil -> array kosong (bukan throw)", () => {
  assert.deepEqual(searchCommands(idx, "zzzztakada"), []);
});
