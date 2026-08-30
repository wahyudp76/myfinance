// Test domain warna tema (src/domain/theme.js) -- fitur "Warna Aksen".
// Sifat: murni (tanpa DOM), deterministik penuh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESET_THEMES, normalizeThemeColor, buildAccentShades, contrastText, hexToRgb } from "../../src/domain/theme.js";

// ===================== normalizeThemeColor =====================

test("normalizeThemeColor: terima #abc, #aabbcc, tanpa #, uppercase", () => {
  assert.equal(normalizeThemeColor("#0f8"), "#00ff88");
  assert.equal(normalizeThemeColor("#10B981"), "#10b981");
  assert.equal(normalizeThemeColor("10b981"), "#10b981");
  assert.equal(normalizeThemeColor("  #6366F1  "), "#6366f1");
});

test("normalizeThemeColor: tolak input tidak valid -> null", () => {
  assert.equal(normalizeThemeColor(""), null);
  assert.equal(normalizeThemeColor("   "), null);
  assert.equal(normalizeThemeColor("bukan-warna"), null);
  assert.equal(normalizeThemeColor("#12345"), null);
  assert.equal(normalizeThemeColor("#1234567"), null);
  assert.equal(normalizeThemeColor("#gggggg"), null);
  assert.equal(normalizeThemeColor(null), null);
  assert.equal(normalizeThemeColor(undefined), null);
  assert.equal(normalizeThemeColor(123), null);
  assert.equal(normalizeThemeColor({ r: 16, g: 185, b: 129 }), null);
});

// ===================== buildAccentShades =====================

test("buildAccentShades: 500 = warna dasar; ramp monoton makin terang/gelap", () => {
  const s = buildAccentShades("#10b981");
  assert.equal(s["500"], "#10b981");
  // Membaca channel R sebagai proksi "makin mendekati putih utk shade rendah"
  // (base R=16 rendah -- mix ke putih harus menaikkan r secara monoton).
  const lum = (hex) => { const { r, g, b } = hexToRgb(hex); return r + g + b; };
  assert.ok(lum(s["50"]) > lum(s["100"]), "50 lebih terang dari 100");
  assert.ok(lum(s["100"]) > lum(s["300"]), "100 lebih terang dari 300");
  assert.ok(lum(s["300"]) > lum(s["400"]), "300 lebih terang dari 400");
  assert.ok(lum(s["400"]) > lum(s["500"]), "400 lebih terang dari 500");
  assert.ok(lum(s["600"]) < lum(s["500"]), "600 lebih gelap dari 500");
  assert.ok(lum(s["700"]) < lum(s["600"]), "700 lebih gelap dari 600");
});

test("buildAccentShades: nilai campur deterministik (hitam -> putih/hitam)", () => {
  const s = buildAccentShades("#000000");
  // mix(#000, putih, 0.93) = round(255*0.93) = 237 = 0xed
  assert.equal(s["50"], "#ededed");
  assert.equal(s["100"], "#d9d9d9"); // round(255*0.85) = 217 = 0xd9
  assert.equal(s["300"], "#8c8c8c"); // round(255*0.55) = 140 = 0x8c
  assert.equal(s["400"], "#474747"); // round(255*0.28) = 71 = 0x47
  assert.equal(s["600"], "#000000"); // campur dgn hitam tetap hitam
  assert.equal(s["700"], "#000000");
});

test("buildAccentShades: input tidak valid -> null (bukan throw)", () => {
  assert.equal(buildAccentShades("oesen"), null);
  assert.equal(buildAccentShades(null), null);
  assert.equal(buildAccentShades("#12g45z"), null);
});

test("buildAccentShades: helper mode gelap & alpha format benar", () => {
  const s = buildAccentShades("#10b981");
  assert.match(s.darkChipRgba, /^rgba\(16, 185, 129, 0\.16\)$/);
  assert.match(s.faint10Rgba, /^rgba\(16, 185, 129, 0\.1\)$/);
  assert.match(s.shade50Alpha60Rgba, /^rgba\(\d+, \d+, \d+, 0\.6\)$/);
});

// ===================== contrastText =====================

test("contrastText: dasar gelap -> teks putih, dasar sangat terang -> teks gelap", () => {
  assert.equal(contrastText("#10b981"), "#ffffff"); // zamrud (YIQ ~128)
  assert.equal(contrastText("#f43f5e"), "#ffffff"); // rose
  assert.equal(contrastText("#6366f1"), "#ffffff"); // indigo
  assert.equal(contrastText("#ffffff"), "#0f172a"); // putih
  assert.equal(contrastText("#fef08a"), "#0f172a"); // kuning sangat terang
});

// ===================== PRESET_THEMES =====================

test("PRESET_THEMES: semua valid, unik, emerald pertama (bawaan)", () => {
  assert.ok(PRESET_THEMES.length >= 8);
  assert.equal(PRESET_THEMES[0].id, "emerald");
  assert.equal(PRESET_THEMES[0].color, "#10b981");
  const colors = new Set();
  for (const t of PRESET_THEMES) {
    assert.equal(normalizeThemeColor(t.color), t.color, `preset ${t.id} harus sudah normal`);
    colors.add(t.color);
    assert.ok(t.id && t.label, `preset ${t.id} butuh label`);
  }
  assert.equal(colors.size, PRESET_THEMES.length, "warna preset tidak boleh dobel");
});
