import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBaseCategoryStyle, categorizeParentFromLookup, categoryStyleCtx } from "../../src/domain/category-style.js";

// Lookup contoh (meniru bentuk categoryDict/subCategoryLookup monolit).
const categoryDict = {
  pengeluaran: {
    Makanan: { icon: "fa-utensils", bg: "bg-amber-100", color: "text-amber-600", subs: [{ name: "Makan Siang" }, { name: "Kopi" }] },
    Transport: { icon: "fa-car", bg: "bg-sky-100", color: "text-sky-500", subs: [] },
  },
  pemasukan: {
    Gaji: { icon: "fa-money-bill-wave", bg: "bg-emerald-100", color: "text-emerald-600", subs: [] },
  },
};
const subCategoryLookup = {
  "Makan Siang": { parentName: "Makanan", icon: "fa-utensils", bg: "bg-amber-100", color: "text-amber-600", type: "pengeluaran" },
  Kopi: { parentName: "Makanan", icon: "fa-mug-hot", bg: "bg-amber-100", color: "text-amber-600", type: "pengeluaran" },
};

const ctx = { categoryDict, subCategoryLookup };

test("resolveBaseCategoryStyle: Transfer selalu parent 'Transfer'", () => {
  const s = resolveBaseCategoryStyle({ ...ctx, catName: "X", jenis: "Transfer" });
  assert.deepEqual(s, { icon: "fa-exchange-alt", bg: "bg-blue-100", color: "text-blue-500", parent: "Transfer", parentName: "Transfer" });
});

test("resolveBaseCategoryStyle: sub-kategori -> lihat subCategoryLookup (parentName dari lookup)", () => {
  const s = resolveBaseCategoryStyle({ ...ctx, catName: "Makan Siang", jenis: "Pengeluaran" });
  assert.equal(s.parentName, "Makanan");
  // entry sub lookup tidak punya key `parent` (hanya parentName/icon/bg/color/type);
  // modul mengembalikan objek lookup apa adanya -- konsisten dgn monolit.
  assert.equal(s.parent, undefined);
});

test("resolveBaseCategoryStyle: parent Pengeluaran -> dirinya sendiri", () => {
  const s = resolveBaseCategoryStyle({ ...ctx, catName: "Makanan", jenis: "Pengeluaran" });
  assert.equal(s.parentName, "Makanan");
  assert.equal(s.parent, "Makanan");
  assert.equal(s.icon, "fa-utensils");
});

test("resolveBaseCategoryStyle: parent Pemasukan -> dirinya sendiri", () => {
  const s = resolveBaseCategoryStyle({ ...ctx, catName: "Gaji", jenis: "Pemasukan" });
  assert.equal(s.parentName, "Gaji");
});

test("resolveBaseCategoryStyle: kategori tak dikenal + Pemasukan -> 'Lain-lain'", () => {
  const s = resolveBaseCategoryStyle({ ...ctx, catName: "Hobby", jenis: "Pemasukan" });
  assert.equal(s.parentName, "Lain-lain");
  assert.equal(s.bg, "bg-emerald-100");
});

test("resolveBaseCategoryStyle: kategori tak dikenal + default -> 'Lain-lain' rose", () => {
  const s = resolveBaseCategoryStyle({ ...ctx, catName: "Hobby", jenis: "Pengeluaran" });
  assert.equal(s.parentName, "Lain-lain");
  assert.equal(s.bg, "bg-rose-100");
});

test("categorizeParentFromLookup: mengembalikan parentName", () => {
  assert.equal(categorizeParentFromLookup({ ...ctx, catName: "Kopi", jenis: "Pengeluaran" }), "Makanan");
  assert.equal(categorizeParentFromLookup({ ...ctx, catName: "Gaji", jenis: "Pemasukan" }), "Gaji");
  assert.equal(categorizeParentFromLookup({ ...ctx, catName: "Misteri", jenis: "Pengeluaran" }), "Lain-lain");
});

test("resolveBaseCategoryStyle: lookup kosong tidak melempar (toleran null)", () => {
  const s = resolveBaseCategoryStyle({ categoryDict: null, subCategoryLookup: null, catName: "X", jenis: "Pengeluaran" });
  assert.equal(s.parentName, "Lain-lain");
});

test("categoryStyleCtx: menyediakan fungsi resolusi", () => {
  const c = categoryStyleCtx();
  assert.equal(typeof c.resolveBaseCategoryStyle, "function");
  assert.equal(typeof c.categorizeParentFromLookup, "function");
});
