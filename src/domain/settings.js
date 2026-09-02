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

/**
 * Validasi form ganti kata sandi (modal Edit Profil). Murni: tanpa network --
 * pemanggil (index.html) yang melanjutkan ke supabase.auth.updateUser().
 * Mengembalikan { valid, error } -- error selalu string|null.
 */
export function validatePasswordChange(password, confirm, { minLength = 8 } = {}) {
  const pw = String(password == null ? "" : password);
  const cf = String(confirm == null ? "" : confirm);
  if (!pw) return { valid: false, error: "Kata sandi baru tidak boleh kosong." };
  if (pw.length < minLength) return { valid: false, error: `Kata sandi minimal ${minLength} karakter.` };
  if (pw !== cf) return { valid: false, error: "Konfirmasi kata sandi tidak sama." };
  return { valid: true, error: null };
}

// ============================================================================
// Validasi bentuk OVERRIDE IKON/AVATAR KUSTOM (accountIcons & categoryStyles).
// ============================================================================
// LATAR BELAKANG: nilai override ikon bisa sampai ke state aplikasi lewat DUA
// jalur yang isinya TIDAK 100% tepercaya: (1) tabel cloud custom_icons (dipakai
// lintas perangkat), dan (2) restore backup JSON (settings ditimpa mentah dari
// file). Nilai-nilai ini dirender ke innerHTML (atribut src="...", class="...",
// teks badge), jadi bentuk di luar pola yang SAH (mis. berisi tanda kutip atau
// karakter markup) berpotensi menyuntik atribut/event handler HTML. Pola di
// bawah ini mencakup SEMUA nilai yang bisa dihasilkan UI (upload gambar lewat
// modal -> data URL hasil kompresi, logo bank internal -> icons/banks/*, pilihan
// palet -> token kelas Tailwind/ikon FA, badge huruf). Nilai lain dianggap
// tidak sah -> dibuang/di-fallback ke ikon netral.

/** Satu token nama kelas CSS (mis. bg-amber-100, text-white, w-3.5). */
export const CLASS_TOKEN_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
/** Satu token ikon Font Awesome (mis. fa-wallet, fa-money-bill-wave). */
export const FA_ICON_TOKEN_RE = /^fa-[a-zA-Z0-9-]+$/;
/** Teks badge bank/e-wallet pendek (mis. "BCA", "OVO") -- tanpa markup. */
export const BADGE_TEXT_RE = /^[A-Za-z0-9 .+&_-]{1,8}$/;
/**
 * Data URL gambar yang sah utk <img src>: raster umum + svg+xml (svg dalam
 * konteks <img> tidak mengeksekusi skrip -- pasif). Ini bentuk yang dihasilkan
 * upload modal (compressImageDataUrl -> jpeg/webp/png; fallback file mentah
 * kecil -> mime image/* apa pun dari daftar ini).
 */
export const ICON_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml);base64,[A-Za-z0-9+/=\r\n]+$/i;
/** Path aset ikon bank internal yang diserve aplikasi (lihat icons/banks/). */
export const ICON_ASSET_PATH_RE = /^icons\/banks\/[A-Za-z0-9_.-]+\.(?:svg|png|jpe?g|webp)$/i;

/** True kalau `v` adalah token nama kelas tunggal yang aman dipakai di atribut class. */
export function isSafeClassToken(v) {
  return typeof v === "string" && CLASS_TOKEN_RE.test(v);
}

/** True kalau `v` adalah token ikon Font Awesome yang aman dipakai di class. */
export function isSafeFaIconToken(v) {
  return typeof v === "string" && FA_ICON_TOKEN_RE.test(v);
}

/**
 * True kalau `v` aman dipakai sebagai isi atribut src="..." tanpa escape
 * tambahan: data URL gambar raster/base64 (alfabet base64 tidak mengandung
 * tanda kutip) atau path aset internal icons/banks/*.
 */
export function isSafeIconImageUrl(v) {
  return typeof v === "string" && (ICON_DATA_URL_RE.test(v) || ICON_ASSET_PATH_RE.test(v));
}

function optionalClassToken(v) {
  return v == null || isSafeClassToken(v);
}

function optionalBadgeColor(v) {
  return v == null || isSafeClassToken(v);
}

/**
 * Validasi SATU objek override ikon/gaya (bentuk yang disimpan di
 * accountIcons[name] / categoryStyles[jenis][nama]): {type, value, ...}.
 * Bentuk sah (sesuai yg dihasilkan modal UI):
 *   { type:'image', value:<data URL | icons/banks/...>, alt?:string }
 *   { type:'icon', value:<fa-...>, bg?:<token>, color?:<token> }
 *   { type:'icon-plain', value:<fa-...>, color?:<token> }
 *   { type:'badge', value:<teks pendek>, bg/color?:<token> }
 * Mengembalikan salinan yang SUDAH terverifikasi aman, atau null kalau bentuk
 * di luar pola (harus di-fallback pemanggil ke ikon netral).
 */
export function sanitizeIconOverride(override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return null;
  const o = override;
  const t = o.type;
  if (t === "image") {
    if (!isSafeIconImageUrl(o.value)) return null;
    const alt = typeof o.alt === "string" ? o.alt.slice(0, 200) : "";
    return { type: "image", value: o.value, alt };
  }
  if (t === "icon") {
    if (!isSafeFaIconToken(o.value)) return null;
    if (!optionalClassToken(o.bg) || !optionalClassToken(o.color)) return null;
    const out = { type: "icon", value: o.value };
    if (typeof o.bg === "string") out.bg = o.bg;
    if (typeof o.color === "string") out.color = o.color;
    return out;
  }
  if (t === "icon-plain") {
    if (!isSafeFaIconToken(o.value)) return null;
    if (!optionalClassToken(o.color)) return null;
    const out = { type: "icon-plain", value: o.value };
    if (typeof o.color === "string") out.color = o.color;
    return out;
  }
  if (t === "badge") {
    if (typeof o.value !== "string" || !BADGE_TEXT_RE.test(o.value)) return null;
    if (!optionalBadgeColor(o.bg) || !optionalBadgeColor(o.color)) return null;
    const out = { type: "badge", value: o.value };
    if (typeof o.bg === "string") out.bg = o.bg;
    if (typeof o.color === "string") out.color = o.color;
    return out;
  }
  return null;
}

/**
 * Bersihkan SEMUA peta override ikon/gaya di dalam `settings` (dimutasi
 * langsung, konsisten gaya kode lain): entri dengan bentuk di luar pola sah
 * DIBUANG. Dipanggil pemilik data sebelum menimpa appSettings dari sumber
 * yang tidak sepenuhnya tepercaya (restore backup JSON), supaya override yang
 * direkayasa tidak ikut tersimpan & tersebar ke cloud.
 *
 * @param {object} settings - objek appSettings (dimutasi langsung)
 * @returns {object} settings yang sama (untuk rantai pemanggilan)
 */
export function sanitizeSettingsIconOverrides(settings) {
  if (!settings || typeof settings !== "object") return settings;

  const cleanMap = (map) => {
    if (!map || typeof map !== "object") return;
    Object.keys(map).forEach((key) => {
      const safe = sanitizeIconOverride(map[key]);
      if (safe) map[key] = safe;
      else delete map[key];
    });
  };

  if (settings.accountIcons) cleanMap(settings.accountIcons);

  const cat = settings.categoryStyles;
  if (cat && typeof cat === "object") {
    for (const jenis of ["pengeluaran", "pemasukan"]) {
      const map = cat[jenis];
      if (map && typeof map === "object") {
        Object.keys(map).forEach((key) => {
          const val = map[key];
          const safe = val && typeof val === "object" && !Array.isArray(val)
            ? sanitizeIconOverride(val)
            : null;
          if (safe) map[key] = safe;
          else delete map[key];
        });
      }
    }
  }

  return settings;
}
