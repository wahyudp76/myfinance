/**
 * Pure settings-domain helpers. No DOM, Supabase, localStorage or network access.
 */

/**
 * Nama-nama peta di dalam appSettings yang di-key oleh NAMA akun (bukan ID stabil, karena
 * akun di aplikasi ini memang cuma string, bukan baris tabel dgn id). Kalau suatu akun
 * dihapus ATAU di-rename, entri lama di SEMUA peta ini harus ikut dibuang -- kalau tidak,
 * entrinya jadi "menempel" secara diam-diam ke akun BARU yang kebetulan dibuat dengan nama
 * persis sama di kemudian hari (mis. akun lama "Rekening USD" dgn currency USD dihapus,
 * lalu user bikin akun baru "Rekening USD" yang harusnya IDR biasa -- tanpa fix ini, akun
 * baru itu akan diam-diam dianggap USD juga oleh getAccountCurrency()).
 */
export const ACCOUNT_KEYED_SETTINGS_MAPS = ["accountIcons", "account_currencies"];

/**
 * Membuang entri `removedName` dari semua peta yang di-key oleh nama akun. Memutasi
 * `appSettings` secara langsung (konsisten dengan gaya kode index.html yang lain, yang
 * memang memutasi appSettings di tempat lalu memanggil persistSettings()).
 *
 * @param {object} appSettings - objek appSettings (dimutasi langsung)
 * @param {string} removedName - nama akun yang baru dihapus/di-rename
 * @returns {Record<string, boolean>} peta -> true kalau map itu SEBELUMNYA punya entri utk
 *   nama ini (dipakai pemanggil utk tahu apakah perlu sinkron hapus ke cloud, mis. utk
 *   ikon kustom yang tersimpan di tabel custom_icons terpisah).
 */
export function pruneAccountKeyedMaps(appSettings, removedName) {
  const hadEntry = {};
  for (const mapKey of ACCOUNT_KEYED_SETTINGS_MAPS) {
    const map = appSettings[mapKey];
    hadEntry[mapKey] = Boolean(map && Object.prototype.hasOwnProperty.call(map, removedName));
    if (map) delete map[removedName];
  }
  return hadEntry;
}
