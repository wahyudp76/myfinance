// Unit test domain sparkline HUD (src/domain/sparkline.js) -- murni, tanpa DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalDateKey, buildDailyFlow, sparklineGeometry, sparklineSvg } from "../../src/domain/sparkline.js";

const TODAY = new Date(2026, 7, 31); // 31 Agu 2026 (bulan 0-based)

test("toLocalDateKey memakai tanggal lokal, bukan UTC", () => {
  assert.equal(toLocalDateKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(toLocalDateKey(new Date(2026, 11, 31)), "2026-12-31");
});

test("buildDailyFlow: jumlah hari = days, urut lama -> baru, berakhir di today", () => {
  const flow = buildDailyFlow([], { days: 7, today: TODAY });
  assert.equal(flow.length, 7);
  assert.equal(flow[0].key, "2026-08-25");
  assert.equal(flow[6].key, "2026-08-31");
  assert.deepEqual(flow[3], { key: "2026-08-28", in: 0, out: 0, net: 0 });
});

test("buildDailyFlow: agregasi in/out/net per tanggal, Transfer diabaikan", () => {
  const rows = [
    { tanggal: "2026-08-30", jenis: "Pemasukan", jumlah: "100000" },
    { tanggal: "2026-08-30", jenis: "Pengeluaran", jumlah: "40000" },
    { tanggal: "2026-08-30", jenis: "Transfer", jumlah: "999999" },
    { tanggal: "2026-08-31", jenis: "Pengeluaran", jumlah: "25000" },
    { tanggal: "2026-01-01", jenis: "Pemasukan", jumlah: "777" }, // di luar jendela
  ];
  const flow = buildDailyFlow(rows, { days: 3, today: TODAY });
  const d30 = flow.find((d) => d.key === "2026-08-30");
  const d31 = flow.find((d) => d.key === "2026-08-31");
  assert.deepEqual(d30, { key: "2026-08-30", in: 100000, out: 40000, net: 60000 });
  assert.equal(d31.out, 25000);
  assert.equal(flow.every((d) => d.in !== 777), true);
});

test("buildDailyFlow: jumlah negatif dinormalkan (abs), input rusak aman", () => {
  const rows = [
    { tanggal: "2026-08-31", jenis: "Pemasukan", jumlah: "-5000" },
    { tanggal: "2026-08-31", jenis: "Pengeluaran", jumlah: "abc" },
    { tanggal: null, jenis: "Pemasukan", jumlah: "1" },
    null,
  ];
  const flow = buildDailyFlow(rows, { days: 2, today: TODAY });
  assert.equal(flow[1].in, 5000);
  assert.equal(flow[1].out, 0);
});

test("buildDailyFlow: rows bukan array / days invalid -> tidak melempar", () => {
  assert.equal(buildDailyFlow(undefined, { days: 4, today: TODAY }).length, 4);
  assert.equal(buildDailyFlow([], { days: 0, today: TODAY }).length, 14);
  assert.equal(buildDailyFlow([], { today: "bukan-date" }).length, 14);
});

test("sparklineGeometry: nilai naik-turun memetakan y dalam rentang [pad, h-pad]", () => {
  const g = sparklineGeometry([0, 10, 5, 10], { width: 90, height: 20, pad: 2 });
  assert.equal(g.width, 90);
  assert.equal(g.height, 20);
  const ys = [...g.line.matchAll(/L [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(ys.every((y) => y >= 2 && y <= 18), `y keluar rentang: ${ys}`);
  assert.match(g.line, /^M 2 /);
  assert.ok(g.area.endsWith("Z"));
  assert.ok(g.last);
});

test("sparklineGeometry: nilai seragam -> garis datar di tengah, tanpa NaN", () => {
  const g = sparklineGeometry([7, 7, 7], { width: 60, height: 24, pad: 3 });
  assert.ok(!g.line.includes("NaN"));
  assert.ok(g.line.includes("12"), `harus di tengah (y=12): ${g.line}`);
  assert.deepEqual(g.last, { x: 57, y: 12 });
});

test("sparklineGeometry: kosong -> garis tengah + last null; 1 titik -> di tengah", () => {
  const empty = sparklineGeometry([], { width: 40, height: 10 });
  assert.equal(empty.last, null);
  assert.match(empty.line, /^M 0 5 L 40 5$/);
  const one = sparklineGeometry([42], { width: 40, height: 10, pad: 2 });
  assert.deepEqual(one.last, { x: 20, y: 5 });
});

test("sparklineSvg: memuat gradient, area, garis, titik ujung, dan stroke diminta", () => {
  const svg = sparklineSvg([1, 5, 3], { stroke: "#34d399", id: "in" });
  assert.match(svg, /^<svg /);
  assert.match(svg, /linearGradient id="hud-spark-in"/);
  assert.match(svg, /stroke="#34d399"/);
  assert.match(svg, /<circle /);
  assert.match(svg, /aria-hidden="true"/);
});

test("sparklineSvg: tanpa data tetap menghasilkan svg valid (tanpa circle)", () => {
  const svg = sparklineSvg([], {});
  assert.match(svg, /^<svg .*<\/svg>$/);
  assert.equal(svg.includes("<circle"), false);
});

test("sparklineSvg: id tidak lazim disanitasi (aman utk selector url(#...))", () => {
  const svg = sparklineSvg([1, 2], { id: "a b/c$d" });
  assert.match(svg, /id="hud-spark-abcd"/);
  assert.match(svg, /url\(#hud-spark-abcd\)/);
});
