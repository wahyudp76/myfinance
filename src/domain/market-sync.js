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

/**
 * Label tanggal "data pasar" utk UI (id-ID, "d MMM yyyy" -- mis. "30 Agu 2026").
 * Menerima "YYYY-MM-DD" MAUPUN ISO datetime lengkap (di-slice 10 karakter pertama
 * -- bentuk yang dikembalikan Edge refresh-asset-price lewat field tanggal_pasar).
 * Mengembalikan null utk input tidak valid -- pemanggil boleh langsung menyembunyikan
 * segmen tanggal saat null (aset lama yang belum punya tanggal_nav).
 */
export function formatNavDate(dateStr) {
  if (typeof dateStr !== "string") return null;
  const v = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // Validasi zona-aman (pola sama dgn isBibitNavDate): parse sbg UTC supaya
  // toISOString() bisa dibandingkan langsung dgn string sumbernya.
  const check = new Date(v + "T00:00:00Z");
  if (isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== v) return null;
  // Format: local midnight supaya toLocaleDateString menghasilkan tanggal yang
  // SAMA di zona waktu mana pun (pola identik dgn sinceLabel di app.js).
  const d = new Date(v + "T00:00:00");
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Label sumber utk toast/UI. Sumber tak dikenal ditampilkan apa adanya. */
export function describeSyncSource(source) {
  switch (source) {
    case "reksadana_bibit": return "NAB/UP Bibit (pasar riil)";
    case "manual_nav": return "NAB/UP input manual";
    default: return source ? String(source) : "tidak diketahui";
  }
}
