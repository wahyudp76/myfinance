// Unit test domain chart-hud (src/domain/chart-hud.js) -- murni, tanpa DOM/Chart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HUD_COLORS, HUD_GLOW_VIOLET, hudGlowPlugin, hudAlpha, hudBarDataset, hudDonutGlowPlugin, hudDonutSegment, hudLineDataset, hudLineScales } from "../../src/domain/chart-hud.js";

function fakeGradientCtx() {
  const stops = [];
  return {
    stops,
    chart: {
      chartArea: { left: 0, right: 100, top: 0, bottom: 50 },
      ctx: { createLinearGradient: () => ({ addColorStop: (p, c) => stops.push([p, c]) }) },
    },
  };
}

test("hudAlpha: hex + alpha -> rgba; input tak valid -> transparan", () => {
  assert.equal(hudAlpha("#22d3ee", 0.5), "rgba(34,211,238,0.5)");
  assert.equal(hudAlpha("#F43F5E", 1), "rgba(244,63,94,1)");
  assert.equal(hudAlpha("xyz", 0.3), "rgba(0,0,0,0.3)");
  assert.equal(hudAlpha("#22d3ee", 5), "rgba(34,211,238,1)"); // clamp
  assert.equal(hudAlpha("#22d3ee", -2), "rgba(34,211,238,0)");
});

test("hudLineDataset bawaan = DNA balanceTrend (gradasi cyan->violet, crosshair, tension .45)", () => {
  const d = hudLineDataset();
  assert.equal(d.fill, true);
  assert.equal(d.tension, 0.45);
  assert.equal(d.borderWidth, 3);
  assert.equal(d.pointStyle, "crossRot");
  assert.equal(d.pointRadius, 6);
  assert.equal(d.pointHoverRadius, 9);
  assert.equal(d.pointBackgroundColor, HUD_COLORS.pointCore);
  assert.equal(d.pointBorderColor, HUD_COLORS.pointEdge);
  assert.equal(typeof d.borderColor, "function");
  assert.equal(typeof d.backgroundColor, "function");
});

test("hudLineDataset: borderColor scriptable = gradasi from->to; tanpa chartArea = warna polos", () => {
  const d = hudLineDataset({ from: "#10b981", to: "#34d399" });
  const ctx = fakeGradientCtx();
  d.borderColor(ctx);
  assert.deepEqual(ctx.stops, [[0, "#10b981"], [1, "#34d399"]]);
  assert.equal(d.borderColor({ chart: { chartArea: null, ctx: {} } }), "#10b981");
});

test("hudLineDataset: backgroundColor = gradasi vertikal 0.30/0.10/0 dari warna fill", () => {
  const d = hudLineDataset({ from: "#f43f5e", fill: "#f43f5e" });
  const ctx = fakeGradientCtx();
  d.backgroundColor(ctx);
  assert.deepEqual(ctx.stops, [
    [0, "rgba(244,63,94,0.3)"],
    [0.65, "rgba(244,63,94,0.1)"],
    [1, "rgba(244,63,94,0)"],
  ]);
  assert.equal(d.backgroundColor({ chart: { chartArea: null, ctx: {} } }), "rgba(244,63,94,0.12)");
});

test("hudLineDataset: padat (>12 titik) -> crosshair mengecil; gradient:false -> garis solid", () => {
  const dense = hudLineDataset({ points: 31 });
  assert.equal(dense.pointRadius, 3.5);
  assert.equal(dense.pointHoverRadius, 6);
  const solid = hudLineDataset({ from: "#a78bfa", gradient: false });
  assert.equal(solid.borderColor, "#a78bfa");
});

test("hudLineScales: tick teknis T-kode & Y-kode saat tidak padat; padat -> tanpa T-kode", () => {
  const s = hudLineScales(["Agu", "Sep"], (v) => v + "K");
  assert.equal(s.x.ticks.callback(0, 0), "T01·Agu");
  assert.equal(s.x.ticks.callback(0, 1), "T02·Sep");
  assert.equal(s.y.ticks.callback(4), "Y·4K");
  assert.equal(s.x.grid.color, HUD_COLORS.gridX);

  const many = Array.from({ length: 31 }, (_, i) => "d" + i);
  const d = hudLineScales(many, (v) => String(v));
  assert.equal(d.x.ticks.callback, undefined);
  assert.equal(d.y.ticks.callback(9), "Y·9");
});

test("hudLineScales: input rusak aman + yGrid custom dihormati", () => {
  const s = hudLineScales(null, null, { yGrid: "#123456" });
  assert.equal(s.x.ticks.callback(0, 0), "T01·undefined");
  assert.equal(s.y.ticks.callback(1), "Y·1");
  assert.equal(s.y.grid.color, "#123456");
});

test("hudGlowPlugin: id tetap 'hudGlow' (kontrak inline lama) + save/restore ctx", () => {
  const calls = [];
  const chart = { ctx: { save: () => calls.push("save"), restore: () => calls.push("restore") } };
  assert.equal(hudGlowPlugin.id, "hudGlow");
  hudGlowPlugin.beforeDatasetsDraw(chart);
  hudGlowPlugin.afterDatasetsDraw(chart);
  assert.deepEqual(calls, ["save", "restore"]);
});

function fakeGradient() {
  const stops = [];
  return { g: { addColorStop: (o, c) => stops.push([o, c]) }, stops };
}

test("hudBarDataset: bentuk dasar + fallback warna solid tanpa geometri", () => {
  const ds = hudBarDataset({ from: "#34d399" });
  assert.equal(ds.borderRadius, 6);
  assert.equal(ds.borderSkipped, false);
  assert.equal(ds.borderWidth, 1);
  assert.equal(typeof ds.backgroundColor, "function");
  // tanpa element/ctx -> fallback solid
  assert.equal(ds.backgroundColor({ dataIndex: 0, element: null, chart: null }), "#34d399");
  assert.equal(ds.hoverBackgroundColor({ dataIndex: 0 }), "#34d399");
  assert.equal(ds.borderColor({ dataIndex: 0 }), "rgba(52,211,153,0.9)");
  assert.equal(ds.barPercentage, 0.92); // default rapat (permintaan pemilik)
  assert.equal(ds.categoryPercentage, 0.92);
  const ds2 = hudBarDataset({ from: "#22d3ee", barPercentage: 0.6, maxBarThickness: 28 });
  assert.equal(ds2.barPercentage, 0.6);
  assert.equal(ds2.maxBarThickness, 28);
});

test("hudBarDataset: gradasi vertikal dari chartArea (aktif sejak render pertama) + array per batang", () => {
  const { g, stops } = fakeGradient();
  const chart = { ctx: { createLinearGradient: (...a) => { g._args = a; return g; } }, chartArea: { top: 20, bottom: 120 }, width: 200, height: 150 };
  const ds = hudBarDataset({ from: ["#34d399", "#fb7185"] });
  const fill = ds.backgroundColor({ dataIndex: 1, chart });
  assert.equal(fill, g);
  assert.deepEqual(g._args, [0, 20, 0, 120]); // chartArea, bukan geometri elemen
  assert.deepEqual(stops, [[0, "#fb7185"], [1, "rgba(251,113,133,0.32)"]]);
  // tanpa chartArea (resolve paling awal) -> pakai tinggi kanvas, tetap gradasi
  const { g: g2 } = fakeGradient();
  const chart2 = { ctx: { createLinearGradient: (...a) => { g2._args = a; return g2; } }, height: 150 };
  assert.equal(ds.backgroundColor({ dataIndex: 0, chart: chart2 }), g2);
  assert.deepEqual(g2._args, [0, 0, 0, 150]);
});

test("hudDonutSegment: sudut komet dari data (aktif tanpa klik) + fallback palet solid", () => {
  const fn = hudDonutSegment(["#22d3ee", "#a78bfa"]);
  assert.equal(fn({ dataIndex: 1, chart: null, dataset: { data: [30, 70] } }), "#a78bfa");
  const { g, stops } = fakeGradient();
  let args = null;
  const chart = { ctx: { createLinearGradient: (...a) => { args = a; return g; } }, chartArea: { left: 0, top: 0, right: 200, bottom: 200 }, width: 200, height: 200 };
  const fill = fn({ dataIndex: 0, chart, dataset: { data: [30, 70] } });
  assert.equal(fill, g);
  assert.deepEqual(stops, [[0, "#22d3ee"], [1, "rgba(34,211,238,0.5)"]]);
  assert.ok(args.every((v) => Number.isFinite(v)));
  // palet rusak -> cyan default
  const fb = hudDonutSegment(null);
  assert.equal(fb({ dataIndex: 3, chart: null, dataset: { data: [1] } }), "#22d3ee");
});

test("hudDonutGlowPlugin: id 'hudGlow', glow violet, save/restore", () => {
  const calls = [];
  const chart = { ctx: { save: () => calls.push("save"), restore: () => calls.push("restore") } };
  assert.equal(hudDonutGlowPlugin.id, "hudGlow");
  assert.equal(HUD_GLOW_VIOLET, "rgba(167,139,250,0.45)");
  hudDonutGlowPlugin.beforeDatasetsDraw(chart);
  hudDonutGlowPlugin.afterDatasetsDraw(chart);
  assert.deepEqual(calls, ["save", "restore"]);
});
