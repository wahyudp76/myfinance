// ============================================================================
// PILOT MIGRASI MONOLIT → MODUL (v79): detectAssetCategoryIcon -- pemetaan
// kategori ASET (investasi) ke ikon Font Awesome, murni & deterministik.
// ============================================================================
// Dulu hanya hidup di blok classic (monolit) app.src.js -- tanpa rumah & unit
// test, padahal di-inject (DI) sebagai `detectAssetCategoryIcon` ke modul
// ter-tes src/ui/assets.js (render tab Aset). Karena murni (kategori -> nama
// ikon, tanpa state/DOM), bisa diuji langsung & di-adopt modul via jalur
// servicesModule (pola yang sama dengan modul migrasi lain).
//
// Perilaku dijamin byte-compatible dengan implementasi asli monolit (guard
// konsistensi di tests/unit/asset-icons-domain.test.js). Urutan pengecekan
// sub-string PENTING (mis. 'reksa' harus dicek sebelum 'saham' bila kategorinya
// bisa mengandung keduanya); jangan ubah tanpa mengubah test.

/**
 * Peta kategori aset (dicocokkan tidak-huruf-besar, substring) ke ikon Font Awesome.
 * Kategori yang tidak dikenali -> ikon netral 'fa-gem'.
 * @param {*} kategori nama kategori aset (string apa pun; non-string di-coerce).
 * @returns {string} nama ikon Font Awesome class (tanpa awalan 'fas ').
 */
export function detectAssetCategoryIcon(kategori) {
    const k = String(kategori || '').toLowerCase();
    if (k.includes('saham')) return 'fa-chart-line';
    if (k.includes('reksa')) return 'fa-layer-group';
    if (k.includes('emas') || k.includes('logam')) return 'fa-coins';
    if (k.includes('kripto') || k.includes('crypto') || k.includes('bitcoin')) return 'fa-bitcoin-sign';
    if (k.includes('properti') || k.includes('tanah') || k.includes('rumah')) return 'fa-house';
    if (k.includes('deposito') || k.includes('tabungan')) return 'fa-piggy-bank';
    if (k.includes('obligasi') || k.includes('bond')) return 'fa-file-contract';
    return 'fa-gem';
}

/**
 * Konteks helper ikon kategori aset murni. Dipanggil monolit lewat
 * servicesModule.assetIconCtx() agar blok classic mengadopsi implementasi
 * ter-tes ini sebagai satu sumber kebenaran tanpa menghapus definisi global
 * lama terlebih dahulu.
 * @returns {{ detectAssetCategoryIcon: typeof detectAssetCategoryIcon }}
 */
export function assetIconCtx() {
    return { detectAssetCategoryIcon };
}
