// ============================================================================
// v86: resolvePlatformLogoUrl -- pencocokan nama platform/akun ke URL logo dari
// katalog (peta key->url yang diisi dari tabel Supabase `platform_logos`).
// ============================================================================
// DULU: logika pencocokan hidup inline di getAccountLogo() (app.src.js) tanpa
// unit test, dan versi fuzzy-nya (`compactKey.includes(compactName) || ...`)
// punya FALSE POSITIVE nyata: platform "Dana" (e-wallet, 4 huruf) cocok dengan
// key katalog "danamas-stabil" karena "danamasstabil".includes("dana") -> logo
// salah platform dipakai. Pola serupa: "Pintu" vs kategori apa pun ber-"pintu".
//
// Kini murni & ter-uji (tests/unit/platform-logos-domain.test.js), dengan
// aturan berlapis yang aman:
//   1. Kecocokan EXACT nama ternormalisasi (trim + lowercase).
//   2. Kecocokan EXACT bentuk "compact" (buang semua non-alfanumerik) -- menutup
//      variasi tanda baca/spasi ("Danamas Stabil" == "danamas-stabil").
//   3. Kecocokan containment HANYA bila token yang LEBIH PENDEK minimal
//      MIN_FUZZY_LEN (5) karakter -- menutup kasus "bibit.id"/"Reksadana Bibit"
//      -> "bibit", tanpa membuka celah "dana" -> "danamasstabil".
//
// Di-adopt monolit lewat servicesModule.platformLogoCtx() (pola yang sama
// dengan __bankIcon/__assetIcon), nama global getAccountLogo tidak berubah.

/** Panjang minimum token pendek agar containment diizinkan (guard false-positive). */
export const MIN_FUZZY_LEN = 5;

/** Normalisasi nama utk pencocokan: trim + lowercase (bentuk key katalog). */
export function normalizePlatformKey(name) {
  return String(name == null ? "" : name).trim().toLowerCase();
}

/** Bentuk "compact": buang semua karakter non-alfanumerik ("Danamas Stabil" -> "danamasstabil"). */
export function compactPlatformKey(name) {
  return normalizePlatformKey(name).replace(/[^a-z0-9]/g, "");
}

/**
 * Cari URL logo utk `name` di katalog logo platform.
 *
 * @param {Record<string, string>} catalog - peta key(lowercase)->logo_url
 *   (diisi dari tabel platform_logos: key = platform_key & display_name.lowercase).
 * @param {string} name - nama platform/akun yang sedang dirender.
 * @returns {string|null} logo_url bila ada kecocokan yang sah, selain itu null
 *   (pemanggil melanjutkan ke fallback lokal detectAutoAccountIcon).
 */
export function resolvePlatformLogoUrl(catalog, name) {
  if (!catalog || typeof catalog !== "object") return null;
  const normalized = normalizePlatformKey(name);
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(catalog, normalized)) {
    const direct = catalog[normalized];
    if (direct) return direct;
  }
  const compact = compactPlatformKey(name);
  if (!compact) return null;
  let fuzzy = null;
  for (const key of Object.keys(catalog)) {
    const compactKey = compactPlatformKey(key);
    if (compactKey === compact) {
      return catalog[key] || null; // exact compact menang langsung
    }
    // containment dua arah, hanya bila token pendek cukup panjang (anti "dana"->"danamasstabil")
    const shorter = Math.min(compactKey.length, compact.length);
    if (
      fuzzy === null &&
      shorter >= MIN_FUZZY_LEN &&
      (compactKey.includes(compact) || compact.includes(compactKey))
    ) {
      fuzzy = catalog[key];
    }
  }
  return fuzzy || null;
}

/** Objek DI (default-injection) yang dipakai monolit utk meng-adopt modul ter-tes ini. */
export function platformLogoCtx() {
  return { resolvePlatformLogoUrl, normalizePlatformKey, compactPlatformKey, MIN_FUZZY_LEN };
}
