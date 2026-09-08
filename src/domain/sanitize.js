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
 * Membangun atribut aksi UI deklaratif untuk HTML yang DIHASILKAN runtime.
 *
 * Menggantikan pola lama `onclick="fn('${jsStr(nilai)}')"`. Bedanya bukan sekadar
 * gaya: pada pola lama, data pengguna disisipkan ke dalam STRING KODE, sehingga
 * keamanannya bergantung pada jsStr() meloloskan setiap karakter yang bisa
 * memutus literal itu. Di sini data pengguna tidak pernah menjadi kode -- ia
 * menjadi JSON di dalam atribut, lalu dibaca kembali dengan JSON.parse.
 *
 * Argumen di-JSON-kan supaya TIPE-nya utuh (angka tetap angka, boolean tetap
 * boolean), lalu di-escape untuk atribut berkutip ganda.
 *
 * @param {string} action nama aksi yang terdaftar di registry aksi UI.
 * @param {...*} args argumen yang diteruskan ke fungsi aksi.
 * @returns {string} potongan atribut, sudah diawali satu spasi.
 */
export function uiActionAttrs(action, ...args) {
    const dasar = ` data-action="${escapeHtml(action)}"`;
    if (args.length === 0) return dasar;
    return `${dasar} data-args="${escapeHtml(JSON.stringify(args))}"`;
}

/**
 * Konteks helper escape/sanitasi string murni. Dipanggil monolit lewat
 * servicesModule.sanitizeCtx() (pola yang sama dengan formatCtx/dateCtx/
 * categoryStyleCtx) agar blok classic mengadopsi implementasi ter-tes ini
 * sebagai satu sumber kebenaran tanpa menghapus definisi global lama dulu.
 * @returns {{escapeHtml: typeof escapeHtml, jsStr: typeof jsStr, uiActionAttrs: typeof uiActionAttrs}}
 */
export function sanitizeCtx() {
    return { escapeHtml, jsStr, uiActionAttrs };
}
