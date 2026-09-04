// ============================================================================
// PILOT MIGRASI MONOLIT → MODUL (v77): helper ESCAPE/pelolosan string murni.
// ============================================================================
// escapeHtml & jsStr dulu hanya hidup di blok classic (monolit) app.src.js --
// tanpa rumah & tanpa unit test, padahal dipakai di HUNDREDS titik render
// baris (escapeHtml ~50x, jsStr ~20x) dan === lapisan keamanan anti-XSS/anti
// penyisipan sintaks. Di sini ia punya satu sumber kebenaran yang ter-uji unit.
//
// SIFAT: murni & total (string -> string, tanpa state, tanpa DOM). Karena itu
// bisa diuji langsung, dan monolit bisa MENGADOPInya lewat jalur servicesModule
// (pola yang sama dengan format.js/dates.js/category-style.js). Perilaku dijamin
// byte-compatible dengan implementasi asli monolit (guard konsistensi di
// tests/unit/sanitize-domain.test.js).
//
// CATATAN URUTAN escapeHtml: '&' di-escape PERTAMA -- kalau tidak, hasil
// escape sebelumnya (mis. '&amp;') akan di-escape lagi sehingga ganda. Jangan
// mengubah urutan tanpa mengubah test.

/**
 * Escape character HTML yang berbahaya (untuk interpolasi ke konten/atribut HTML).
 * @param {*} str nilai apa pun; di-coerce ke string via String().
 * @returns {string}
 */
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Meloloskan string untuk disisipkan sebagai literal string di dalam kode JS
 * (guard terhadap quote/backslash yang bisa memutus penutupan string pada
 * pembangkit template yang menyisipkan nilai ke dalam script).
 * @param {*} str
 * @returns {string}
 */
export function jsStr(str) {
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}

/**
 * Konteks helper escape/sanitasi string murni. Dipanggil monolit lewat
 * servicesModule.sanitizeCtx() (pola yang sama dengan formatCtx/dateCtx/
 * categoryStyleCtx) agar blok classic mengadopsi implementasi ter-tes ini
 * sebagai satu sumber kebenaran tanpa menghapus definisi global lama dulu.
 * @returns {{escapeHtml: typeof escapeHtml, jsStr: typeof jsStr}}
 */
export function sanitizeCtx() {
    return { escapeHtml, jsStr };
}
