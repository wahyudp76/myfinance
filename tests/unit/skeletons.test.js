// Test builder skeleton dashboard (src/ui/skeletons.js) -- slice design #3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardSkeletonHtml } from "../../src/ui/skeletons.js";

test("dashboardSkeletonHtml: struktur lengkap -- 3 kartu ringkasan, chart, 5 baris daftar", () => {
  const html = dashboardSkeletonHtml();
  assert.ok(html.includes("md:grid-cols-3"), "grid kartu ringkasan");
  assert.ok(html.includes("lg:grid-cols-3"), "grid chart + kartu samping");
  assert.ok(html.includes("h-44 w-full rounded-2xl"), "blok area chart");
  assert.equal((html.match(/h-9 w-9 rounded-full/g) || []).length, 5, "5 baris daftar transaksi");
  assert.equal((html.match(/bg-white rounded-3xl border border-slate-100 p-5/g) || []).length, 6, "3 kartu ringkasan + chart + samping + daftar");
});

test("dashboardSkeletonHtml: semua bone pakai kelas skeleton-bone (animasi/tercela via CSS)", () => {
  const html = dashboardSkeletonHtml();
  const bones = (html.match(/skeleton-bone/g) || []).length;
  assert.ok(bones >= 25, `jumlah bone wajar (>=25), didapat ${bones}`);
});

test("dashboardSkeletonHtml: dekoratif -- aria-hidden, tanpa data/NaN/undefined", () => {
  const html = dashboardSkeletonHtml();
  assert.ok(html.includes('aria-hidden="true"'), " konten dekoratif ditandai");
  assert.ok(!html.includes("undefined"));
  assert.ok(!html.includes("NaN"));
  assert.ok(!/\$\{|\}\}/.test(html), "tidak ada template literal yang bocor");
});

test("dashboardSkeletonHtml: deterministik (2 panggilan identik)", () => {
  assert.equal(dashboardSkeletonHtml(), dashboardSkeletonHtml());
});
