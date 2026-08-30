/**
 * Pure helpers aksesibilitas modal (slice design #2). Tanpa DOM nyata -- semua
 * fungsi menerima tree/daftar elemen hasil-injeksi supaya bisa diuji unit
 * dengan stub (pola ctx-injection repo). Integrasi nyata (keydown + observer)
 * ada di index.html memakai fungsi-fungsi ini lewat servicesModule.
 */

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Kumpulkan elemen focusable di dalam `root`, urut sesuai DOM, buang yang
 * disabled / hidden / ber-tabindex -1. `root` cukup punya querySelectorAll;
 * elemen stub cukup punya getAttribute + classList.contains.
 */
export function getFocusable(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  const els = Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE_SELECTOR));
  return els.filter((el) => {
    if (el.disabled) return false;
    if (el.hasAttribute && el.hasAttribute("hidden")) return false;
    if (el.classList && el.classList.contains("hidden")) return false;
    // querySelectorAll asli sudah mengecualikan [tabindex="-1"] via selector --
    // dicek ulang eksplisit supaya filter ini juga benar utk sumber lain/stub.
    if (el.getAttribute && el.getAttribute("tabindex") === "-1") return false;
    return true;
  });
}

/**
 * Keputusan focus-trap utk satu tekan TAB (dipanggil pemanggil nyata saat
 * keydown Tab dengan modal teratas). Return elemen yang harus difokuskan,
 * atau null kalau tidak perlu intervensi (fokus masih di dalam & belum mentok).
 * @param {Element[]} focusables daftar hasil getFocusable(modal)
 * @param {Element|null} activeEl document.activeElement saat ini
 * @param {boolean} shift e.shiftKey
 */
export function nextTabTarget(focusables, activeEl, shift) {
  if (!focusables.length) return null;
  const idx = focusables.indexOf(activeEl);
  if (idx === -1) {
    // fokus di luar modal (atau body) -> tarik masuk
    return shift ? focusables[focusables.length - 1] : focusables[0];
  }
  if (!shift && idx === focusables.length - 1) return focusables[0];     // mentok akhir -> awal
  if (shift && idx === 0) return focusables[focusables.length - 1];      // mentok awal -> akhir
  return null; // biarkan default browser
}

/**
 * Pilih modal TERATAS dari kandidat: yang terlihat (tidak .hidden) dengan
 * z-index terbesar. `getZ(el)` disuntik (di browser: computed style; di test:
 * stub) supaya fungsi ini tetap murni.
 * @returns {Element|null}
 */
export function pickTopModal(candidates, getZ) {
  let top = null, topZ = -Infinity;
  for (const el of candidates || []) {
    if (!el || !el.classList || el.classList.contains("hidden")) continue;
    const z = Number(getZ(el));
    if (z > topZ) { topZ = z; top = el; }
  }
  return top;
}

/**
 * Nama aksesibel utk modal: ambil teks heading pertama (h2/h3) di dalamnya,
 * fallback ke id. Dipakai setupModalA11y() utk mengisi aria-label modal yang
 * belum punya nama (role="dialog" tanpa nama = tidak membantu screen reader).
 */
export function modalAccessibleName(modal, querySelector) {
  if (!modal) return "";
  if (modal.getAttribute && modal.getAttribute("aria-label")) return modal.getAttribute("aria-label");
  const q = querySelector || ((sel) => (typeof modal.querySelector === "function" ? modal.querySelector(sel) : null));
  const heading = q("h2") || q("h3") || q("[id$='-title']");
  // guard null eksplisit: tanpa ini `heading && (...)` menghasilkan null yang
  // di-String() jadi "null" (tertangkap unit test).
  const text = heading ? (heading.innerText || heading.textContent || "") : "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean || (modal.id ? String(modal.id) : "");
}
