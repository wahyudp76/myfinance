/**
 * MyFinance domain: logika MURNI ekspor/impor backup (tanpa DOM/network/
 * FileReader) — dipindah dari blok "BACKUP & RESTORE" index.html (slice
 * backup, lanjutan Phase 4 split-monolith docs/architecture-modernization-
 * plan.md). Orkestrasi DOM (unduh file, FileReader, modal konfirmasi,
 * toast, insert Supabase) TETAP inline di index.html supaya perilaku &
 * semua pemanggil (termasuk atribut onclick) tidak berubah.
 *
 * Bentuk payload & aturan validasi dipertahankan 100% sama dengan kode lama
 * — ini pemindahan, bukan penulisan ulang. Lihat tests/unit/backup-domain.test.js.
 */

/** Tag aplikasi & versi format file backup (persis konstanta lama inline). */
export const BACKUP_APP_TAG = 'MyFinance';
export const BACKUP_VERSION = 1;

/**
 * Bentuk payload ekspor: satu objek berisi SEMUA data (pengaturan +
 * transaksi + aset + transaksi berulang). `now` bisa disuntik utk test;
 * default = momen pemanggilan (sama dengan new Date() lama inline).
 */
export function buildBackupPayload({ settings, transactions, assets, recurring, now }) {
  return {
    app: BACKUP_APP_TAG,
    backup_version: BACKUP_VERSION,
    exported_at: (now || new Date()).toISOString(),
    settings,
    transactions,
    assets,
    recurring,
  };
}

/**
 * Validasi hasil JSON.parse file backup. Mengembalikan { ok:false, reason }
 * atau { ok:true, backup }. Aturan sama persis versi lama: harus objek
 * truthy, app === 'MyFinance', dan ada .settings.
 */
export function validateBackupFile(parsed) {
  if (!parsed || parsed.app !== BACKUP_APP_TAG || !parsed.settings) {
    return { ok: false, reason: 'not-myfinance' };
  }
  return { ok: true, backup: parsed };
}

/**
 * Ringkasan jumlah item utk teks konfirmasi restore (array kosong /
 * tidak ada dihitung 0 — sama dengan (backup.x || []).length lama).
 */
export function summarizeBackupCounts(backup) {
  return {
    txCount: (backup.transactions || []).length,
    assetCount: (backup.assets || []).length,
    recurCount: (backup.recurring || []).length,
  };
}

/**
 * Pemetaan baris restore: id lama & user_id lama DIBUANG, user_id diganti
 * milik akun yang sedang login — supaya restore ke akun BERBEDA pun aman
 * (id auto-baru, tidak klaim data user lain). Key user_id diletakkan
 * terakhir, persis seperti spread versi lama.
 */
export function mapRestoreRows(list, userId) {
  return (list || []).map(({ id, user_id, ...rest }) => ({ ...rest, user_id: userId }));
}
