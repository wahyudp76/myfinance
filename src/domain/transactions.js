/**
 * MyFinance transaction-list domain logic (pencarian, filter rentang
 * waktu/nominal, & agregasi chart utk tab Riwayat Transaksi).
 *
 * Pure functions only: no DOM, Supabase, localStorage, network, atau
 * Chart.js access. Extracted dari filterTransactions() di index.html
 * (lanjutan Phase 4/7 -- "Break the monolithic client into modules by
 * domain", lihat docs/architecture-modernization-plan.md). Perilaku
 * dipertahankan 100% sama seperti kode lama -- ini pemindahan, bukan
 * penulisan ulang.
 *
 * INI FUNGSI PALING BANYAK DIPAKAI & PALING SERING BERUBAH PARAMETERNYA DI
 * SELURUH APLIKASI (dipanggil ulang tiap kali user mengetik pencarian,
 * ganti filter waktu, tambah/edit/hapus transaksi, dsb) -- makanya
 * dipisah paling akhir dari semua modul domain lain, & TIDAK menyentuh
 * bagian pagination/grouping/render HTML tabel yang masih berat terikat
 * DOM (`tbody`, elemen input filter, state pagination `_txListVisibleLimit`)
 * supaya risiko regresi seminimal mungkin. parseTgl/txIdrAmount/toDateStr
 * SENGAJA disuntik lewat parameter, bukan diduplikasi -- supaya index.html
 * tetap satu-satunya sumber kebenaran untuk fungsi-fungsi itu.
 */

/**
 * Predikat pencarian teks bebas -- cocok kalau `searchQuery` (SUDAH dalam
 * huruf kecil & di-trim oleh pemanggil) ditemukan di salah satu dari
 * kategori/keterangan/jenis/akun transaksi.
 *
 * @param {object} item - 1 baris transaksi.
 * @param {string} searchQuery - HARUS sudah .toLowerCase().trim() oleh pemanggil.
 * @returns {boolean}
 */
export function matchesTransactionSearch(item, searchQuery) {
  const kategori = (item.kategori || "").toLowerCase();
  const keterangan = (item.keterangan || "").toLowerCase();
  const jenis = (item.jenis || "").toLowerCase();
  const akun = (item.akun || "").toLowerCase();
  return kategori.includes(searchQuery) || keterangan.includes(searchQuery) || jenis.includes(searchQuery) || akun.includes(searchQuery);
}

/**
 * Filter "30 Hari Terakhir" + data chart harian (Masuk/Keluar) utk periode
 * itu. `dayKeys` (dan `chartLabels`) SELALU 30 hari penuh, termasuk hari
 * tanpa transaksi (terisi 0) -- persis kode asli.
 *
 * @param {Array<object>} data
 * @param {object} deps
 * @param {Date} deps.now
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @param {(t: object) => number} deps.txIdrAmount
 * @returns {{ filtered: Array<object>, chartLabels: string[], chartIn: number[], chartOut: number[] }}
 */
export function computeLast30DaysView(data, { now, parseTgl, txIdrAmount }) {
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const filtered = (data || []).filter((item) => parseTgl(item.tanggal) >= thirtyDaysAgo);

  const dayKeys = [];
  const inMap = {};
  const outMap = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString("en-CA");
    dayKeys.push(key);
    inMap[key] = 0;
    outMap[key] = 0;
  }
  filtered.forEach((d) => {
    if (!d.tanggal) return;
    const dStr = d.tanggal.split("T")[0];
    if (inMap[dStr] !== undefined) {
      if (d.jenis === "Pemasukan") inMap[dStr] += txIdrAmount(d);
      if (d.jenis === "Pengeluaran") outMap[dStr] += txIdrAmount(d);
    }
  });

  return {
    filtered,
    chartLabels: dayKeys.map((d) => new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" })),
    chartIn: dayKeys.map((d) => inMap[d]),
    chartOut: dayKeys.map((d) => outMap[d]),
  };
}

/**
 * Filter bulan tertentu (dari input `<input type="month">`, "YYYY-MM") +
 * data chart harian (Masuk/Keluar) utk SEMUA hari di bulan itu (terisi 0
 * kalau tanpa transaksi). Kalau `monthYearVal` kosong, kembalikan `data`
 * apa adanya & chart kosong -- persis kode asli (belum ada bulan dipilih).
 *
 * @param {Array<object>} data
 * @param {string} monthYearVal - "YYYY-MM", boleh string kosong/falsy.
 * @param {object} deps
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @param {(t: object) => number} deps.txIdrAmount
 * @returns {{ filtered: Array<object>, chartLabels: string[], chartIn: number[], chartOut: number[] }}
 */
export function computeCustomMonthView(data, monthYearVal, { parseTgl, txIdrAmount }) {
  if (!monthYearVal) return { filtered: data, chartLabels: [], chartIn: [], chartOut: [] };

  // split() SELALU menghasilkan string ("2026", "09"), sedangkan getFullYear()/
  // getMonth() menghasilkan number -- sebelumnya ini disamakan lewat `==` yang
  // mengandalkan koersi implisit. Koersi dibuat EKSPLISIT sekali di sini supaya
  // perbandingan di bawah murni number-vs-number (dan lolos aturan eqeqeq).
  const [yearRaw, monthRaw] = monthYearVal.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const filtered = (data || []).filter((item) => {
    const d = parseTgl(item.tanggal);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });

  const daysInMonth = new Date(year, month, 0).getDate();
  const inMap = {};
  const outMap = {};
  for (let i = 1; i <= daysInMonth; i++) { inMap[i] = 0; outMap[i] = 0; }
  filtered.forEach((d) => {
    if (!d.tanggal) return;
    const day = parseTgl(d.tanggal).getDate();
    if (inMap[day] !== undefined) {
      if (d.jenis === "Pemasukan") inMap[day] += txIdrAmount(d);
      if (d.jenis === "Pengeluaran") outMap[day] += txIdrAmount(d);
    }
  });

  const chartLabels = [];
  const chartIn = [];
  const chartOut = [];
  for (let i = 1; i <= daysInMonth; i++) { chartLabels.push(String(i)); chartIn.push(inMap[i]); chartOut.push(outMap[i]); }

  return { filtered, chartLabels, chartIn, chartOut };
}

/**
 * Filter rentang tanggal bebas (dari-sampai) + data chart. Granularitas
 * chart otomatis: rentang <=31 hari -> per HARI (detail), lebih panjang
 * -> per BULAN (biar chart tidak sesak batang). Kalau salah satu/kedua
 * tanggal kosong, `filtered` tetap dikembalikan apa adanya (tanpa
 * filter di sisi yang kosong itu) & chart kosong kalau BUKAN keduanya
 * terisi -- persis kode asli.
 *
 * @param {Array<object>} data
 * @param {string} fromVal - "YYYY-MM-DD", boleh kosong/falsy.
 * @param {string} toVal - "YYYY-MM-DD", boleh kosong/falsy.
 * @param {object} deps
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @param {(t: object) => number} deps.txIdrAmount
 * @param {(d: Date) => string} deps.toDateStr - format lokal "YYYY-MM-DD" (bukan UTC, lihat komentar toDateStr() di index.html).
 * @returns {{ filtered: Array<object>, chartLabels: string[], chartIn: number[], chartOut: number[] }}
 */
export function computeDateRangeView(data, fromVal, toVal, { parseTgl, txIdrAmount, toDateStr }) {
  let filtered = data;
  if (fromVal || toVal) {
    const fromDate = fromVal ? parseTgl(fromVal) : null;
    const toDate = toVal ? parseTgl(toVal) : null;
    filtered = (data || []).filter((item) => {
      const d = parseTgl(item.tanggal);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  }

  let chartLabels = [];
  let chartIn = [];
  let chartOut = [];

  if (fromVal && toVal) {
    const fromDate = parseTgl(fromVal);
    const toDate = parseTgl(toVal);
    const spanDays = Math.round((toDate - fromDate) / 86400000) + 1;

    if (spanDays > 0 && spanDays <= 31) {
      const inMap = {};
      const outMap = {};
      for (let i = 0; i < spanDays; i++) {
        const d = new Date(fromDate);
        d.setDate(d.getDate() + i);
        const key = toDateStr(d);
        inMap[key] = 0;
        outMap[key] = 0;
      }
      filtered.forEach((d) => {
        if (!d.tanggal) return;
        const dStr = toDateStr(parseTgl(d.tanggal));
        if (inMap[dStr] !== undefined) {
          if (d.jenis === "Pemasukan") inMap[dStr] += txIdrAmount(d);
          if (d.jenis === "Pengeluaran") outMap[dStr] += txIdrAmount(d);
        }
      });
      const keys = Object.keys(inMap);
      chartLabels = keys.map((k) => parseTgl(k).toLocaleDateString("id-ID", { day: "numeric", month: "short" }));
      chartIn = keys.map((k) => inMap[k]);
      chartOut = keys.map((k) => outMap[k]);
    } else if (spanDays > 0) {
      const inMap = {};
      const outMap = {};
      const order = [];
      const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
      const endCursor = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
      while (cursor <= endCursor) {
        const key = cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0");
        order.push(key);
        inMap[key] = 0;
        outMap[key] = 0;
        cursor.setMonth(cursor.getMonth() + 1);
      }
      filtered.forEach((d) => {
        if (!d.tanggal) return;
        const dd = parseTgl(d.tanggal);
        const key = dd.getFullYear() + "-" + String(dd.getMonth() + 1).padStart(2, "0");
        if (inMap[key] !== undefined) {
          if (d.jenis === "Pemasukan") inMap[key] += txIdrAmount(d);
          if (d.jenis === "Pengeluaran") outMap[key] += txIdrAmount(d);
        }
      });
      chartLabels = order.map((k) => { const [y, m] = k.split("-"); return new Date(y, m - 1, 1).toLocaleDateString("id-ID", { month: "short", year: "2-digit" }); });
      chartIn = order.map((k) => inMap[k]);
      chartOut = order.map((k) => outMap[k]);
    }
  }

  return { filtered, chartLabels, chartIn, chartOut };
}

/**
 * Predikat "Filter Lanjutan" rentang nominal -- berlaku orthogonal
 * terhadap filter waktu manapun yang aktif (bisa dipakai bersamaan).
 *
 * @param {object} item
 * @param {number|null} amountMin - null = tanpa batas bawah.
 * @param {number|null} amountMax - null = tanpa batas atas.
 * @param {object} deps
 * @param {(t: object) => number} deps.txIdrAmount
 * @returns {boolean}
 */
export function isWithinAmountRange(item, amountMin, amountMax, { txIdrAmount }) {
  const amt = txIdrAmount(item);
  if (amountMin != null && amt < amountMin) return false;
  if (amountMax != null && amt > amountMax) return false;
  return true;
}

/**
 * Total bersih SEKELOMPOK transaksi (mis. semua transaksi di 1 tanggal
 * yang sama) = Pemasukan dikurangi Pengeluaran. Transfer TIDAK dihitung
 * (cuma memindahkan uang antar akun, tidak menambah/mengurangi kekayaan
 * bersih) -- dipakai utk badge ringkasan per-hari di daftar Riwayat
 * Transaksi. BEDA dari computeAccountGroupNet() di src/domain/accounts.js:
 * fungsi itu dihitung RELATIF TERHADAP 1 akun spesifik (transfer masuk/
 * keluar akun itu ikut mempengaruhi), sedangkan ini ringkasan lintas-akun
 * (transfer diabaikan sepenuhnya, sesuai sifatnya yang netral antar akun).
 *
 * @param {Array<object>} rows
 * @param {object} deps
 * @param {(t: object) => number} deps.txIdrAmount
 * @returns {number}
 */
export function computeDayNetTotal(rows, { txIdrAmount }) {
  let netTotal = 0;
  (rows || []).forEach((row) => {
    if (row.jenis === "Pemasukan") netTotal += txIdrAmount(row);
    else if (row.jenis === "Pengeluaran") netTotal -= txIdrAmount(row);
  });
  return netTotal;
}

/**
 * Urutan globalData = urutan yang dikembalikan server oleh list():
 * tanggal DESC, id ASC. Baris baru (id-nya pasti lebih besar dari baris
 * se-tanggal yang sudah ada) diapit TEPAT SETELAH baris se-tanggal terakhir,
 * dan SEBELUM baris dengan tanggal lebih lama.
 *
 * Murni & bebas efek samping (mengembalikan array baru) -- dipakai echo lokal
 * pasca-simpan di index.html supaya state lokal identik dengan hasil fetch
 * ulang, TANPA request tambahan.
 */
export function insertTransactionRow(rows, row) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (!row) return list;
  if (row.tanggal == null) {
    list.push(row);
    return list;
  }
  let idx = list.findIndex((r) => String(r.tanggal) < String(row.tanggal));
  if (idx === -1) idx = list.length;
  list.splice(idx, 0, row);
  return list;
}

/**
 * Ganti baris transaksi berdasarkan id (hasil UPDATE), atau sisipkan sebagai
 * baris baru kalau id-nya belum ada. Kalau tanggalnya berubah, baris
 * dikeluarkan lalu disisipkan ulang di posisi urutan server yang benar.
 */
export function replaceTransactionRow(rows, row) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (!row || row.id == null) return list;
  const idx = list.findIndex((r) => String(r.id) === String(row.id));
  if (idx === -1) return insertTransactionRow(list, row);
  const sameDate = String(list[idx].tanggal) === String(row.tanggal);
  list[idx] = row;
  if (!sameDate) {
    const moved = list.splice(idx, 1);
    return insertTransactionRow(list, moved[0]);
  }
  return list;
}
