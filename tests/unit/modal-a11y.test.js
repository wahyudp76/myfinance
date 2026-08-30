// Test pure helpers aksesibilitas modal (src/ui/modal-a11y.js) -- slice design #2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getFocusable, nextTabTarget, pickTopModal, modalAccessibleName, FOCUSABLE_SELECTOR } from "../../src/ui/modal-a11y.js";

// ---- stub ringan ----
function el(tag, { disabled, hidden, cls = "", tabindex, text } = {}) {
  const classes = new Set(cls.split(" ").filter(Boolean));
  const attrs = {};
  if (disabled) attrs.disabled = "";
  if (hidden) attrs.hidden = "";
  if (tabindex !== undefined) attrs.tabindex = String(tabindex);
  return {
    tag, disabled: !!disabled, textContent: text || "",
    classList: { contains: (c) => classes.has(c) },
    hasAttribute: (a) => Object.prototype.hasOwnProperty.call(attrs, a),
    getAttribute: (a) => (a === "aria-label" ? attrs["aria-label"] : attrs[a] ?? null),
  };
}
function root(children) {
  return { querySelectorAll: (sel) => (sel === FOCUSABLE_SELECTOR ? children : []) };
}

// ===================== getFocusable =====================

test("getFocusable: buang disabled/hidden/tabindex-1, pertahankan sisanya", () => {
  const btn = el("button");
  const input = el("input");
  const off = el("button", { disabled: true });
  const hid = el("button", { hidden: true });
  const cls = el("button", { cls: "hidden foo" });
  const neg = el("div", { tabindex: -1 });
  const out = getFocusable(root([btn, off, hid, cls, neg, input]));
  assert.deepEqual(out, [btn, input]);
});

test("getFocusable: root tanpa querySelectorAll -> [] (bukan throw)", () => {
  assert.deepEqual(getFocusable(null), []);
  assert.deepEqual(getFocusable({}), []);
});

// ===================== nextTabTarget =====================

test("nextTabTarget: mentok akhir -> kembali ke awal (wrap maju)", () => {
  const a = el("button"), b = el("input"), c = el("button");
  const f = [a, b, c];
  assert.equal(nextTabTarget(f, c, false), a);
  assert.equal(nextTabTarget(f, b, false), null); // tengah: default browser
});

test("nextTabTarget: shift di awal -> ke akhir (wrap mundur)", () => {
  const a = el("button"), b = el("input"), c = el("button");
  const f = [a, b, c];
  assert.equal(nextTabTarget(f, a, true), c);
  assert.equal(nextTabTarget(f, b, true), null);
});

test("nextTabTarget: fokus di luar modal -> ditarik masuk", () => {
  const a = el("button"), b = el("input");
  const outside = el("button");
  assert.equal(nextTabTarget([a, b], outside, false), a);
  assert.equal(nextTabTarget([a, b], null, true), b);
});

test("nextTabTarget: tanpa focusable -> null", () => {
  assert.equal(nextTabTarget([], el("body"), false), null);
});

// ===================== pickTopModal =====================

test("pickTopModal: pilih yang terlihat dgn z-index terbesar", () => {
  const a = el("div", { cls: "" });   // z 90
  const b = el("div", { cls: "" });   // z 97
  const c = el("div", { cls: "hidden" }); // tersembunyi, z 999 -- diabaikan
  const top = pickTopModal([a, b, c], (x) => (x === a ? 90 : x === b ? 97 : 999));
  assert.equal(top, b);
});

test("pickTopModal: semua tersembunyi / kosong -> null", () => {
  assert.equal(pickTopModal([el("div", { cls: "hidden" })], () => 5), null);
  assert.equal(pickTopModal(null, () => 5), null);
});

// ===================== modalAccessibleName =====================

test("modalAccessibleName: aria-label eksis dipertahankan; tanpa itu pakai heading", () => {
  const labeled = { getAttribute: (a) => (a === "aria-label" ? "Sudah ada" : null) };
  assert.equal(modalAccessibleName(labeled), "Sudah ada");
  const withHeading = {
    id: "modalX",
    getAttribute: () => null,
    querySelector: (sel) => (sel === "h2" ? { innerText: "  Tambah   Akun  " } : null),
  };
  assert.equal(modalAccessibleName(withHeading), "Tambah Akun");
});

test("modalAccessibleName: tanpa heading -> id; normalisasi whitespace", () => {
  const onlyId = { id: "modalGoal", getAttribute: () => null, querySelector: () => null };
  assert.equal(modalAccessibleName(onlyId), "modalGoal");
  const messy = { getAttribute: () => null, querySelector: (sel) => (sel === "h3" ? { textContent: "Atur\n\nAnggaran  🎯" } : null) };
  assert.equal(modalAccessibleName(messy), "Atur Anggaran 🎯");
});
