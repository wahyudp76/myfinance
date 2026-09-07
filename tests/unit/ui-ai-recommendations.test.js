import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAiRecommendationRow, renderAiRecommendations } from "../../src/ui/ai-recommendations.js";

/** Stub document minimal (pola tests/unit/ui-insights.test.js). */
function makeFakeDocument(elements) {
  return { getElementById: (id) => elements[id] || null };
}

const makeEl = () => ({ innerHTML: "", addEventListener: null, __aiRecs: null, __aiRecClickBound: false });

const RECS = [
  { title: "Kurangi Makanan", short: "Budget terpakai 92%.", detail: "Analisis panjang pertama.", severity: "warning", icon: "fa-triangle-exclamation", bg: "bg-amber-100", color: "text-amber-600" },
  { title: "Bagus, menabung naik", short: "Tingkat menabung 18%.", detail: "Analisis panjang kedua.", severity: "success", icon: "fa-thumbs-up", bg: "bg-emerald-100", color: "text-emerald-600" },
];

test("renderAiRecommendationRow: tombol full-width + data-ai-rec-idx + teks di-escape", () => {
  const html = renderAiRecommendationRow({ ...RECS[0], title: "A <b>injeksi</b>" }, 3);
  assert.match(html, /data-ai-rec-idx="3"/);
  assert.match(html, /w-full/); // list vertikal: baris selebar container
  assert.match(html, /fa-chevron-right/); // affordance "bisa diklik"
  assert.match(html, /aria-haspopup="dialog"/);
  assert.ok(!/<b>injeksi<\/b>/.test(html)); // escapeHtml bekerja
  assert.match(html, /A &lt;b&gt;injeksi&lt;\/b&gt;/);
});

test("renderAiRecommendations: list vertikal ter-render & terbaru tersimpan di container", () => {
  const container = makeEl();
  const doc = makeFakeDocument({ "ai-insights-container": container });
  const okRender = renderAiRecommendations({ document: doc, recommendations: RECS });
  assert.equal(okRender, true);
  assert.equal(container.__aiRecs, RECS);
  assert.match(container.innerHTML, /data-ai-rec-idx="0"/);
  assert.match(container.innerHTML, /data-ai-rec-idx="1"/);
  assert.ok(container.innerHTML.indexOf('data-ai-rec-idx="0"') < container.innerHTML.indexOf('data-ai-rec-idx="1"'));
});

test("renderAiRecommendations: render ULANG menimpa data terbaru (anti detail basi)", () => {
  const container = makeEl();
  const doc = makeFakeDocument({ "ai-insights-container": container });
  renderAiRecommendations({ document: doc, recommendations: RECS });
  const baru = [{ title: "Baru", short: "s", detail: "d", severity: "info", icon: "fa-lightbulb", bg: "bg-indigo-100", color: "text-indigo-600" }];
  renderAiRecommendations({ document: doc, recommendations: baru });
  assert.equal(container.__aiRecs, baru);
  assert.ok(!/data-ai-rec-idx="1"/.test(container.innerHTML));
  assert.match(container.innerHTML, /Baru/);
});

test("renderAiRecommendations: kosong / container hilang -> false, tanpa error", () => {
  const container = makeEl();
  const doc = makeFakeDocument({ "ai-insights-container": container });
  assert.equal(renderAiRecommendations({ document: doc, recommendations: [] }), false);
  assert.equal(renderAiRecommendations({ document: doc, recommendations: null }), false);
  assert.equal(renderAiRecommendations({ document: makeFakeDocument({}), recommendations: RECS }), false);
  assert.equal(container.innerHTML, ""); // tidak tersentuh
});

test("renderAiRecommendations: delegasi klik container (tanpa addEventListener) tidak error", () => {
  // Stub tanpa addEventListener (seperti stub test lama) -> guard harus diam.
  const container = { innerHTML: "", __aiRecs: null, __aiRecClickBound: false };
  const doc = makeFakeDocument({ "ai-insights-container": container });
  assert.doesNotThrow(() => renderAiRecommendations({ document: doc, recommendations: RECS }));
});
