// supabase/functions/_shared/market-sync.js
// MIRROR dari src/domain/market-sync.js (modul murni, tanpa dependensi) --
// disalin utuh agar Edge Function bisa bundle via import relatif.

/**
 * Pure helpers utk sinkronisasi nilai aset dari data pasar (NAB/UP reksadana,
 * harga per unit lainnya). Tanpa DOM/network/localStorage.
 *
 * Aturan value_history DISENGAJAKAN identik dgn submitAsset() di index.html dan
 * Edge Function refresh-asset-price: 1 titik per tanggal; edit/sync berulang di
 * hari yg sama MENIMPA titik hari itu; titik baru hanya kalau nilai berubah.
 */

/**
 * Validasi tanggal NAB "YYYY-MM-DD": format benar, tanggal riil, tidak di masa
 * depan (toleransi 1 hari utk selisih zona waktu), dan tidak lebih tua dari
 * 30 hari -- NAB basi tidak layak diklaim sbg nilai pasar terkini.
 */
export function isBibitNavDate(dateStr, now = new Date()) {
  if (typeof dateStr !== "string") return false;
  const v = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
  const diffDays = (now.getTime() - d.getTime()) / 86400000;
  return diffDays >= -1 && diffDays <= 30;
}

/** Pembulatan Rupiah utk nilai aset (sama seperti Edge Function: Math.round). */
export function roundIdr(n) {
  const v = Number(n);
  if (!isFinite(v)) return null;
  return Math.round(v);
}

/**
 * nilai = NAB per unit x jumlah unit, dibulatkan ke Rupiah terdekat.
 * Mengembalikan null kalau input tidak valid (NaN/<=0) -- pemanggil wajib
 * menolak null, jangan pernah menyimpan 0 diam-diam.
 */
export function computeMarketValue(navPerUnit, units) {
  const nav = Number(navPerUnit);
  const u = Number(units);
  if (!isFinite(nav) || nav <= 0 || !isFinite(u) || u <= 0) return null;
  return Math.round(nav * u);
}

/**
 * Terapkan nilai pasar baru ke bentuk baris aset: mengembalikan object patch
 * { nilai, terakhir, value_history } siap kirim ke updateAsset().
 * - `asset.value_history` array lama (boleh kosong/undefined),
 * - `today` string YYYY-MM-DD (disuntik utk kemurnian),
 * - `nowIso` string ISO timestamp `terakhir` (disuntik; default new Date().toISOString()).
 * Bila nilaiBaru sama dgn nilai lama, titik history tidak ditambah (aturan
 * change-only) tapi `terakhir` tetap diperbarui -- sync tetap tercatat waktunya.
 */
export function withSyncedValue(asset, { nilaiBaru, today, nowIso } = {}) {
  const nilai = Number(nilaiBaru);
  if (!isFinite(nilai) || nilai <= 0) throw new Error("nilaiBaru tidak valid.");
  const tgl = String(today || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) throw new Error("today wajib YYYY-MM-DD.");
  const stamp = nowIso || new Date().toISOString();
  const history = Array.isArray(asset && asset.value_history) ? asset.value_history.slice() : [];
  const lama = Number(asset && asset.nilai);
  if (isFinite(lama) && lama === nilai) {
    // nilai sama: jangan menambah/menimpa titik (tidak informatif), cukup stempel waktu
    return { nilai, terakhir: stamp, value_history: history };
  }
  const sameDayIdx = history.findIndex((h) => h && h.tanggal === tgl);
  if (sameDayIdx >= 0) history[sameDayIdx] = { tanggal: tgl, nilai };
  else history.push({ tanggal: tgl, nilai });
  return { nilai, terakhir: stamp, value_history: history };
}

/** Label sumber utk toast/UI. Sumber tak dikenal ditampilkan apa adanya. */
export function describeSyncSource(source) {
  switch (source) {
    case "reksadana_bibit": return "NAB/UP Bibit (pasar riil)";
    case "manual_nav": return "NAB/UP input manual";
    default: return source ? String(source) : "tidak diketahui";
  }
}
