/**
 * MyFinance domain: pembangkit DATA CONTOH (Tier-3 onboarding #8).
 *
 * Murni & DETERMINISTIK (tanpa Math.random/network/DOM) -- dua panggilan
 * dgn input sama menghasilkan array identik, jadi bisa di-unit-test persis.
 * Dipakai seedDemoData() di index.html utk tombol "Isi Data Contoh" pada
 * empty-state Dashboard pengguna baru.
 *
 * Penandaan: SEMUA keterangan diberi prefix "[Demo] " (DEMO_MARKER) supaya:
 * (a) user tahu baris mana yang contoh, (b) removeDemoData() bisa menghapus
 * massal via filter LIKE '[Demo]%' TANPA menyentuh transaksi asli, (c) aman
 * di Postgres LIKE (bracket literal, bukan character-class).
 *
 * Nama kategori/akun memakai BAWAAN app (defaultCategoryDict/defaultSettings)
 * supaya ikon & palet kategori tetap resolves; transaksi menyimpan nama SUB
 * di field `kategori` (konvensi app -- lihat resolveCategoryAndSubNames).
 */
export const DEMO_MARKER = "[Demo]";

export function isDemoTransaction(t) {
  return !!t && typeof t.keterangan === "string" && t.keterangan.startsWith(DEMO_MARKER);
}

function iso(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Bangun transaksi contoh utk bulan LALU + bulan ini (hanya tanggal yang sudah
 * lewat -- tidak membuat transaksi masa depan). Skrip tetap sederhana & tetap:
 * gaji awal bulan, freelance, belanja bulanan, tagihan, makan/transport/ kafe
 * tersebar. ~16-24 baris tergantung tanggal hari ini.
 *
 * @param {object} opts
 * @param {Date} [opts.today=new Date()] - disuntik utk test.
 * @param {string[]} [opts.accounts=[]] - nama akun user; kosong -> fallback bawaan.
 * @returns {Array<{tanggal:string, jenis:'Pemasukan'|'Pengeluaran', kategori:string, keterangan:string, jumlah:number, akun:string, mata_uang:'IDR'}>}
 */
export function buildDemoTransactions({ today = new Date(), accounts = [] } = {}) {
  const pool = (accounts && accounts.length) ? accounts : ["Bank BCA", "GoPay", "Tunai (Cash)"];
  const pick = (name, i) => (pool.includes(name) ? name : (pool[i] || pool[0]));

  const y = today.getFullYear();
  const m = today.getMonth() + 1; // 1-12
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;

  // [hari, jenis, kategori(sub), label keterangan, jumlah, akun, indeksFallback]
  const schedule = [
    [1,  "Pemasukan",   "Gaji Pokok",   "Gaji bulanan",        8500000, "Bank BCA",     0],
    [3,  "Pemasukan",   "Freelance",    "Proyek desain",       1200000, "Bank BCA",     0],
    [5,  "Pengeluaran", "Supermarket",  "Belanja mingguan",     750000, "Bank BCA",     0],
    [8,  "Pengeluaran", "Listrik",      "Token listrik",        350000, "Bank BCA",     0],
    [12, "Pengeluaran", "Restoran",     "Makan siang keluarga",  85000, "GoPay",        1],
    [15, "Pengeluaran", "Taksi/Ojol",   "Perjalanan kerja",      45000, "GoPay",        1],
    [18, "Pengeluaran", "Kafe & Kopi",  "Ngopi sore",            35000, "Tunai (Cash)", 2],
    [22, "Pengeluaran", "Pesan Antar",  "Makan malam",           62000, "GoPay",        1],
    [26, "Pengeluaran", "Bensin",       "Isi bensin motor",     100000, "Tunai (Cash)", 2],
  ];

  const rows = [];
  const emit = (year, month, maxDay) => {
    schedule.forEach(([day, jenis, kategori, label, jumlah, akun, fi]) => {
      if (day > maxDay) return; // jangan buat transaksi masa depan
      rows.push({
        tanggal: iso(year, month, day),
        jenis,
        kategori,
        keterangan: `${DEMO_MARKER} ${label}`,
        jumlah,
        akun: pick(akun, fi),
        mata_uang: "IDR",
      });
    });
  };

  emit(prevY, prevM, 31);          // bulan lalu: seluruhnya sudah lewat
  emit(y, m, today.getDate());     // bulan ini: hanya sampai hari ini
  return rows;
}
