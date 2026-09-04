// ============================================================================
// PILOT MIGRASI MONOLIT → MODUL (v79): slugify -- slug nama kategori/parent utk
// id DOM & pengelompokan budget.
// ============================================================================
// Dulu hanya hidup di blok classic (monolit) app.src.js -- tanpa rumah & unit
// test, padahal di-inject (DI) sebagai `slugify` ke modul ter-tes
// src/ui/budgets.js & dipakai di renderCategoryTree. Karena murni & total
// (string -> string, tanpa state/DOM), ia bisa diuji langsung dan monolit bisa
// mengadopsinya lewat jalur servicesModule (pola yang sama dengan
// format.js/dates.js/category-style.js/sanitize.js/export-csv.js).
//
// Perilaku dijamin byte-compatible dengan implementasi asli monolit (guard
// konsistensi di tests/unit/slugify-domain.test.js). Jangan ubah regex tanpa
// mengubah test.

/**
 * Ubah string menjadi slug aman untuk id/attribut DOM & kunci pengelompokan:
 * semua karakter selain huruf/angka diganti underscore. Non-string di-coerce
 * ke String() dulu (null -> "null").
 * @param {*} str
 * @returns {string}
 */
export function slugify(str) {
    return String(str).replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Konteks helper slug murni. Dipanggil monolit lewat
 * servicesModule.slugifyCtx() (pola yang sama dgn formatCtx/dateCtx/
 * categoryStyleCtx/sanitizeCtx) agar blok classic mengadopsi implementasi
 * ter-tes ini sebagai satu sumber kebenaran tanpa menghapus definisi global
 * lama terlebih dahulu.
 * @returns {{ slugify: typeof slugify }}
 */
export function slugifyCtx() {
    return { slugify };
}
