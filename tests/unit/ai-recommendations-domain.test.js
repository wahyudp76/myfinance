import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAiRecommendations, AI_REC_SEVERITY_STYLES, AI_REC_MAX_ITEMS } from "../../src/domain/ai-recommendations.js";

test("normalizeAiRecommendations: input bukan array / kosong -> []", () => {
    assert.deepEqual(normalizeAiRecommendations(null), []);
    assert.deepEqual(normalizeAiRecommendations(undefined), []);
    assert.deepEqual(normalizeAiRecommendations("x"), []);
    assert.deepEqual(normalizeAiRecommendations([]), []);
});

test("normalizeAiRecommendations: format baru (dengan detail) dipertahankan + style severity", () => {
    const out = normalizeAiRecommendations([
        { title: "Kurangi belanja Makanan", message: "Budget Makanan terpakai 92%.", detail: "Baris panjang: analisis + 3 langkah konkret.", severity: "warning" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "Kurangi belanja Makanan");
    assert.equal(out[0].short, "Budget Makanan terpakai 92%.");
    assert.equal(out[0].detail, "Baris panjang: analisis + 3 langkah konkret.");
    assert.equal(out[0].severity, "warning");
    assert.equal(out[0].icon, AI_REC_SEVERITY_STYLES.warning.icon);
    assert.equal(out[0].bg, "bg-amber-100");
    assert.equal(out[0].color, "text-amber-600");
});

test("normalizeAiRecommendations: CACHE LAMA tanpa detail -> fallback detail = message (modal tetap terisi)", () => {
    const out = normalizeAiRecommendations([
        { title: "Rekomendasi lama", message: "Teks singkat era function lama.", severity: "success" },
    ]);
    assert.equal(out[0].detail, "Teks singkat era function lama.");
    assert.equal(out[0].severity, "success");
    assert.equal(out[0].icon, AI_REC_SEVERITY_STYLES.success.icon);
});

test("normalizeAiRecommendations: severity tak dikenal / hilang -> info + style info", () => {
    const out = normalizeAiRecommendations([
        { title: "A", message: "m", severity: "critical" },
        { title: "B", message: "m" },
        { title: "C", message: "m", severity: 123 },
    ]);
    out.forEach((r) => {
        assert.equal(r.severity, "info");
        assert.equal(r.icon, AI_REC_SEVERITY_STYLES.info.icon);
        assert.equal(r.bg, "bg-indigo-100");
    });
});

test("normalizeAiRecommendations: item rusak (bukan objek / tanpa title / tanpa message) dibuang", () => {
    const out = normalizeAiRecommendations([
        null,
        "teks",
        42,
        { title: "tanpa message" },
        { message: "tanpa title" },
        { title: "   ", message: "title kosong setelah trim" },
        { title: "Valid", message: "tetap dipakai", severity: "info" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "Valid");
});

test("normalizeAiRecommendations: dipotong ke AI_REC_MAX_ITEMS", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: "T" + i, message: "m" + i }));
    const out = normalizeAiRecommendations(many);
    assert.equal(out.length, AI_REC_MAX_ITEMS);
    assert.equal(out[0].title, "T0");
    assert.equal(out[AI_REC_MAX_ITEMS - 1].title, "T" + (AI_REC_MAX_ITEMS - 1));
});

test("normalizeAiRecommendations: teks panjang dipangkas & di-trim", () => {
    const out = normalizeAiRecommendations([
        {
            title: "  " + "x".repeat(300) + "  ",
            message: "y".repeat(1000),
            detail: "z".repeat(5000) + "  ",
        },
    ]);
    assert.equal(out[0].title.length, 120);
    assert.equal(out[0].short.length, 600);
    assert.equal(out[0].detail.length, 4000);
});
