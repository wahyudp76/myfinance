import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBaseCategoryStyle, categorizeParentFromLookup, categoryStyleCtx } from "../../src/domain/category-style.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

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

// ---------- helper: ekstrak fungsi DELEGATOR global monolit dari app.src.js ----------
// categorizeParent / categorizeExpenseParent adalah delegator tipis yang memanggil
// __catstyle.categorizeParentFromLookup. Untuk guard konsistensi kita eksekusi sumber
// monolit di TEST-TIME dengan __catstyle/categoryDict/subCategoryLookup (dan, untuk
// the expense delegator, categorizeParent) di-inject.
function extractMonolithFn(name, categorizeParentImpl) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(MONOLITH_SRC);
  assert.ok(m, `function ${name} tidak ditemukan di app.src.js -- kontrak berubah?`);
  const bodyStart = MONOLITH_SRC.indexOf("{", m.index);
  let depth = 0, i = bodyStart;
  for (; i < MONOLITH_SRC.length; i++) {
    const ch = MONOLITH_SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  const fnSource = MONOLITH_SRC.slice(m.index, i + 1);
  // __catstyle.categorizeParentFromLookup di-inject dgn implementasi modul (sumber kebenaran),
  // categoryDict/subCategoryLookup dgn dict contoh, dan (utk expense) categorizeParent dgn
  // delegator monolit yg memegang signature (catName, jenis).
  return Function("__catstyle", "categoryDict", "subCategoryLookup", "categorizeParent",
    `"use strict"; return (${fnSource});`)(
    { categorizeParentFromLookup }, categoryDict, subCategoryLookup, categorizeParentImpl);
}

const monolithFns = {};
try {
  monolithFns.categorizeParent = extractMonolithFn("categorizeParent");
  monolithFns.categorizeExpenseParent = extractMonolithFn("categorizeExpenseParent", monolithFns.categorizeParent);
} catch (e) {
  monolithFns.extractError = e;
}

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

// ============================================================================
// GUARD KONSISTENSI: delegator global monolit == implementasi modul
// ============================================================================
test("categorizeParentFromLookup: sub-kategori & parent & mutasi jenis (dengan dict nyata)", () => {
  assert.equal(categorizeParentFromLookup({ ...ctx, catName: "Makan Siang", jenis: "Pengeluaran" }), "Makanan");
  assert.equal(categorizeParentFromLookup({ ...ctx, catName: "Kopi", jenis: "Pengeluaran" }), "Makanan");
  assert.equal(categorizeParentFromLookup({ ...ctx, catName: "Transport", jenis: "Pengeluaran" }), "Transport");
  assert.equal(categorizeParentFromLookup({ ...ctx, catName: "Gaji", jenis: "Pemasukan" }), "Gaji");
  assert.equal(categorizeParentFromLookup({ ...ctx, catName: "Bohong", jenis: "Pemasukan" }), "Lain-lain");
  assert.equal(categorizeParentFromLookup({ ...ctx, catName: "Bohong", jenis: "Pengeluaran" }), "Lain-lain");
  // null-tolerant
  assert.equal(categorizeParentFromLookup({ categoryDict: null, subCategoryLookup: null, catName: "X", jenis: "Pengeluaran" }), "Lain-lain");
});

test("KONSISTENSI: categorizeParent monolit == categorizeParentFromLookup modul", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = [
    ["Makanan", "Pengeluaran"], ["Kopi", "Pengeluaran"], ["Makan Siang", "Pengeluaran"],
    ["Gaji", "Pemasukan"], ["Transport", "Pengeluaran"], ["Hobby", "Pemasukan"],
    ["Hobby", "Pengeluaran"], ["Misteri", "Pengeluaran"],
  ];
  for (const [cat, jenis] of cases) {
    assert.equal(
      monolithFns.categorizeParent(cat, jenis),
      categorizeParentFromLookup({ ...ctx, catName: cat, jenis }),
      `categorizeParent(${cat}, ${jenis})`,
    );
  }
});

test("KONSISTENSI: categorizeExpenseParent monolit == kategoriParent dengan jenis Pengeluaran", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  for (const cat of ["Makanan", "Kopi", "Makan Siang", "Transport", "Hobby", "Misteri"]) {
    assert.equal(
      monolithFns.categorizeExpenseParent(cat),
      categorizeParentFromLookup({ ...ctx, catName: cat, jenis: "Pengeluaran" }),
      `categorizeExpenseParent(${cat})`,
    );
  }
});

// ============================================================================
// WIRING: pastikan monolit benar2 mengadopsi modul via __catstyle + delegator,
// dan 4 call-site DI tidak lagi memanggil getCategoryStyle().parentName.
// ============================================================================
test("WIRING: app.src.js punya __catstyle + adoptCategoryStyleModule + categorizeParentFromLookup", () => {
  assert.match(MONOLITH_SRC, /let __catstyle\s*=/);
  assert.match(MONOLITH_SRC, /adoptCategoryStyleModule\s*\(/);
  assert.match(MONOLITH_SRC, /__catstyle\s*=\s*servicesModule\.categoryStyleCtx\(\)/);
  assert.match(MONOLITH_SRC, /__catstyle\.categorizeParentFromLookup/);
  // categorizeParent memanggil __catstyle.categorizeParentFromLookup;
  // categorizeExpenseParent memanggil categorizeParent(catName, 'Pengeluaran').
  const parentBody = (MONOLITH_SRC.match(/function\s+categorizeParent\s*\([^)]*\)\s*\{[^}]*\}/) || [""])[0];
  assert.match(parentBody, /categorizeParentFromLookup/, "categorizeParent harus memanggil __catstyle.categorizeParentFromLookup");
  const expenseBody = (MONOLITH_SRC.match(/function\s+categorizeExpenseParent\s*\([^)]*\)\s*\{[^}]*\}/) || [""])[0];
  assert.match(expenseBody, /categorizeParent\s*\([^)]*,\s*'Pengeluaran'\)/, "categorizeExpenseParent harus memanggil categorizeParent(..., 'Pengeluaran')");
});

test("WIRING: call-site DI tidak lagi memakai arrow getCategoryStyle(...).parentName", () => {
  // Pola arrow lama: `categorizeExpenseParent: (kategori) => getCategoryStyle(...).parentName,`
  // Pola arrow lama parent: `categorizeParent: (kategori, jenis) => getCategoryStyle(...).parentName,`
  const oldArrowParent = /categorizeParent\s*:\s*\([^)]*\)\s*=>\s*getCategoryStyle\s*\(/;
  assert.equal(oldArrowParent.test(MONOLITH_SRC), false, "arrow lama categorizeParent masih ada di app.src.js");
  // Harus 4 call-site DI yang mengacu pada delegator baru ini.
  const diRefs = MONOLITH_SRC.match(/categorizeExpenseParent:\s*categorizeExpenseParent,/g) || [];
  const diRefsParent = MONOLITH_SRC.match(/categorizeParent:\s*categorizeParent,/g) || [];
  assert.equal(diRefs.length, 3, "harus 3 call-site categorizeExpenseParent delegator");
  assert.equal(diRefsParent.length, 1, "harus 1 call-site categorizeParent delegator");
});
