import { test } from "node:test";
import assert from "node:assert/strict";
import { CHART_PALETTES, pickChartPalette, chartPaletteLabel } from "../../src/domain/chart-palette.js";
import { SUB_SHARE_COLORS } from "../../src/ui/categories.js";

test("CHART_PALETTES: dua palet, masing-masing 10 warna hex unik", () => {
  assert.deepEqual(Object.keys(CHART_PALETTES).sort(), ["colorblind", "default"]);
  for (const key of ["default", "colorblind"]) {
    const cols = CHART_PALETTES[key].colors;
    assert.equal(cols.length, 10);
    cols.forEach((c) => assert.match(c, /^#[0-9A-Fa-f]{6}$/));
    assert.equal(new Set(cols).size, 10);
  }
});

test("colorblind = Okabe-Ito (biru & oranye kuat, tanpa pasangan merah-hijau membingungkan)", () => {
  const cb = CHART_PALETTES.colorblind.colors;
  assert.equal(cb[0], "#0173B2");
  assert.equal(cb[1], "#DE8F05");
});

test("pickChartPalette: nama valid -> palet itu; tak dikenal/kosong -> default", () => {
  assert.equal(pickChartPalette("colorblind"), CHART_PALETTES.colorblind.colors);
  assert.equal(pickChartPalette("default"), CHART_PALETTES.default.colors);
  assert.equal(pickChartPalette("nihong-ada"), CHART_PALETTES.default.colors);
  assert.equal(pickChartPalette(undefined), CHART_PALETTES.default.colors);
});

test("chartPaletteLabel: label manusiawi, tak dikenal -> Standar", () => {
  assert.equal(chartPaletteLabel("colorblind"), "Ramah Buta Warna");
  assert.equal(chartPaletteLabel("default"), "Standar");
  assert.equal(chartPaletteLabel("xxx"), "Standar");
});

test("SUB_SHARE_COLORS (fallback ui) tetap sama dengan palet default (kompatibilitas visual)", () => {
  assert.deepEqual(SUB_SHARE_COLORS, ["#6366f1", "#8b5cf6", "#06b6d4", "#d946ef", "#10b981", "#f59e0b", "#fb7185", "#3b82f6", "#14b8a6", "#94a3b8"]);
});
