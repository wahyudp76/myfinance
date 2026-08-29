/**
 * MyFinance per-account domain logic.
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Extracted from openAccountDetail() dan buildAccountSeries() di index.html
 * (lanjutan Phase 4 -- "Break the monolithic client into modules by
 * domain", lihat docs/architecture-modernization-plan.md). Perilaku
 * dipertahankan 100% sama seperti kode lama -- ini pemindahan, bukan
 * penulisan ulang.
 *
 * transferTargetAmount/parseTgl SENGAJA disuntik lewat parameter, bukan
 * diduplikasi di sini -- supaya index.html tetap satu-satunya sumber
 * kebenaran untuk fungsi-fungsi itu.
 */

/**
 * Filter transaksi milik 1 akun (baik sebagai akun sumber MAUPUN sebagai
 * akun tujuan transfer) lalu hitung total masuk/keluar/transfer & saldo.
 *
 * @param {Array<object>} transactions - semua transaksi (globalData).
 * @param {string} accName - nama akun yang mau dihitung.
 * @param {object} deps
 * @param {(row: object) => number} deps.transferTargetAmount - nominal sisi tujuan transfer.
 * @returns {{ relatedTx: object[], totalIn: number, totalOut: number, transferIn: number, transferOut: number, balance: number }}
 */
export function computeAccountTotals(transactions, accName, { transferTargetAmount }) {
  const relatedTx = transactions.filter((d) => d.tanggal && (d.akun === accName || (d.jenis === "Transfer" && d.kategori === accName)));

  let totalIn = 0, totalOut = 0, transferIn = 0, transferOut = 0;
  relatedTx.forEach((d) => {
    const amt = Number(d.jumlah) || 0;
    if (d.jenis === "Pemasukan" && d.akun === accName) {
      totalIn += amt;
    } else if (d.jenis === "Pengeluaran" && d.akun === accName) {
      totalOut += amt;
    } else if (d.jenis === "Transfer") {
      if (d.akun === accName) transferOut += amt;
      // Akun ini sbg TUJUAN menerima transferTargetAmount(d) (nominal dlm mata uang akun
      // ini sendiri), bukan `amt` (nominal sisi sumber, yg mata uangnya bisa beda).
      if (d.kategori === accName) transferIn += transferTargetAmount(d);
    }
  });
  const balance = totalIn - totalOut - transferOut + transferIn;

  return { relatedTx, totalIn, totalOut, transferIn, transferOut, balance };
}

/**
 * Bangun deret saldo berjalan (running balance) 1 akun, terurut dari transaksi
 * terlama ke terbaru -- dipakai untuk grafik tren saldo akun.
 *
 * @param {Array<object>} transactions - semua transaksi (globalData).
 * @param {string} accName - nama akun yang mau dihitung.
 * @param {object} deps
 * @param {(row: object) => number} deps.transferTargetAmount - nominal sisi tujuan transfer.
 * @param {(tanggalStr: string) => Date} deps.parseTgl - parser tanggal transaksi.
 * @returns {Array<{ raw: object, date: Date, balance: number, in: number, out: number }>}
 */
export function buildAccountBalanceSeries(transactions, accName, { transferTargetAmount, parseTgl }) {
  const tx = transactions.filter((d) => d.tanggal && (d.akun === accName || (d.jenis === "Transfer" && d.kategori === accName)));
  tx.sort((a, b) => parseTgl(a.tanggal) - parseTgl(b.tanggal));

  let running = 0;
  return tx.map((d) => {
    const amt = Number(d.jumlah) || 0;
    let inAmt = 0, outAmt = 0;
    if (d.jenis === "Pemasukan" && d.akun === accName) {
      running += amt;
      inAmt = amt;
    } else if (d.jenis === "Pengeluaran" && d.akun === accName) {
      running -= amt;
      outAmt = amt;
    } else if (d.jenis === "Transfer") {
      if (d.akun === accName) { running -= amt; outAmt = amt; }
      // Akun ini sbg TUJUAN menerima transferTargetAmount(d) (nominal dlm mata uang akun
      // ini sendiri), bukan `amt`.
      if (d.kategori === accName) {
        const amtTujuan = transferTargetAmount(d);
        running += amtTujuan;
        inAmt = amtTujuan;
      }
    }
    return { raw: d, date: parseTgl(d.tanggal), balance: running, in: inAmt, out: outAmt };
  });
}

/**
 * Siapkan data grafik "Tren Saldo Akun" & "Arus Kas" (bar Masuk/Keluar) utk 1
 * akun: pilih granularitas bucket (hari/minggu/bulan) otomatis dari rentang
 * waktu, lalu agregasi `fullSeries` (dari buildAccountBalanceSeries()) ke
 * dalam bucket-bucket itu. Extracted dari renderAccountDetailCharts().
 *
 * Granularitas: <=62 hari -> per hari, <=400 hari -> per minggu, selebihnya
 * per bulan (angka-angka ini dipertahankan persis dari kode asli).
 *
 * CATATAN: prefix "Awal" (titik saldo tepat sebelum cutoff) HANYA ditambahkan
 * ke `balanceLabels`/`balanceChartData` (dipakai grafik garis Saldo), TIDAK
 * ke `bucketLabels`/`cashInData`/`cashOutData` (dipakai grafik bar Arus Kas)
 * -- asimetri ini disengaja di kode asli, dipertahankan apa adanya.
 *
 * @param {Array<{raw: object, date: Date, balance: number, in: number, out: number}>} fullSeries -
 *   dari buildAccountBalanceSeries(), terurut tanggal lama->baru.
 * @param {'all'|string} periodVal - jumlah hari ke belakang (mis. "180"), atau "all" (tanpa cutoff).
 * @param {object} deps
 * @param {Date} deps.now - waktu "sekarang" (disuntik supaya testable).
 * @returns {{
 *   granularity: 'day'|'week'|'month',
 *   bucketLabels: string[], cashInData: number[], cashOutData: number[],
 *   balanceLabels: string[], balanceChartData: number[],
 *   cutoff: Date|null,
 * }}
 */
export function computeAccountChartSeries(fullSeries, periodVal, { now }) {
  let cutoff = null;
  if (periodVal !== "all") {
    cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(periodVal));
  }

  let startBalance = 0;
  if (cutoff) {
    const before = fullSeries.filter((p) => p.date < cutoff);
    startBalance = before.length ? before[before.length - 1].balance : 0;
  }

  let rangeStartDate = cutoff || (fullSeries.length ? fullSeries[0].date : now);
  if (rangeStartDate > now) rangeStartDate = new Date(now);

  const totalDaysSpan = Math.max(1, Math.ceil((now - rangeStartDate) / 86400000));
  const granularity = totalDaysSpan <= 62 ? "day" : (totalDaysSpan <= 400 ? "week" : "month");

  const buckets = [];
  let cursor = granularity === "month"
    ? new Date(rangeStartDate.getFullYear(), rangeStartDate.getMonth(), 1)
    : new Date(rangeStartDate.getFullYear(), rangeStartDate.getMonth(), rangeStartDate.getDate());

  let safety = 0;
  while (cursor <= now && safety < 800) {
    safety++;
    let bucketEnd, label;
    if (granularity === "day") {
      bucketEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 23, 59, 59, 999);
      label = cursor.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
      buckets.push({ start: new Date(cursor), end: bucketEnd, label });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    } else if (granularity === "week") {
      bucketEnd = new Date(cursor); bucketEnd.setDate(bucketEnd.getDate() + 6); bucketEnd.setHours(23, 59, 59, 999);
      label = cursor.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
      buckets.push({ start: new Date(cursor), end: bucketEnd, label });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    } else {
      bucketEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
      label = cursor.toLocaleDateString("id-ID", { month: "short", year: "2-digit" });
      buckets.push({ start: new Date(cursor), end: bucketEnd, label });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  const bucketLabels = [], balanceData = [], cashInData = [], cashOutData = [];
  let runningLastBalance = startBalance;
  buckets.forEach((b) => {
    const pointsInBucket = fullSeries.filter((p) => p.date >= b.start && p.date <= b.end);
    const sumIn = pointsInBucket.reduce((s, p) => s + p.in, 0);
    const sumOut = pointsInBucket.reduce((s, p) => s + p.out, 0);
    if (pointsInBucket.length) runningLastBalance = pointsInBucket[pointsInBucket.length - 1].balance;
    bucketLabels.push(b.label);
    balanceData.push(runningLastBalance);
    cashInData.push(sumIn);
    cashOutData.push(sumOut);
  });

  const balanceLabels = bucketLabels.slice();
  const balanceChartData = balanceData.slice();
  if (cutoff) { balanceLabels.unshift("Awal"); balanceChartData.unshift(startBalance); }

  return { granularity, bucketLabels, cashInData, cashOutData, balanceLabels, balanceChartData, cutoff };
}

/**
 * Resolve filter kalender "Distribusi Kategori" (di halaman Detail Akun) jadi
 * rentang tanggal [start, end]. `null` di salah satu sisi berarti tanpa
 * batas di sisi itu. Extracted dari renderAccountDetailCharts().
 *
 * @param {'sync'|'this_month'|'last_month'|'this_year'|'last_year'|'custom'|'all'} filterType
 * @param {object} deps
 * @param {Date} deps.now
 * @param {Date|null} deps.syncCutoff - dipakai kalau filterType === 'sync' (cutoff dari filter Rentang Grafik).
 * @param {string|null} [deps.customMonthStr] - "YYYY-MM", dipakai kalau filterType === 'custom'.
 * @returns {{ start: Date|null, end: Date|null }}
 */
export function resolveAccountCategoryDateRange(filterType, { now, syncCutoff, customMonthStr }) {
  if (filterType === "sync") return { start: syncCutoff, end: null };
  if (filterType === "this_month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
  if (filterType === "last_month") {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
    };
  }
  if (filterType === "this_year") return { start: new Date(now.getFullYear(), 0, 1), end: null };
  if (filterType === "last_year") {
    return {
      start: new Date(now.getFullYear() - 1, 0, 1),
      end: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
    };
  }
  if (filterType === "custom" && customMonthStr) {
    const [cy, cm] = customMonthStr.split("-").map(Number);
    return { start: new Date(cy, cm - 1, 1), end: new Date(cy, cm, 0, 23, 59, 59, 999) };
  }
  return { start: null, end: null }; // 'all' (atau 'custom' tanpa bulan dipilih)
}

/**
 * Total pengeluaran 1 akun dikelompokkan per nama kategori PARENT (via
 * getCategoryStyle), dibatasi rentang tanggal opsional -- dipakai baik utk
 * "Pengeluaran Terbesar" (tanpa rentang, all-time) maupun donut "Distribusi
 * Kategori" (dengan rentang dari resolveAccountCategoryDateRange()) di
 * halaman Detail Akun. Extracted dari openAccountDetail() &
 * renderAccountDetailCharts().
 *
 * @param {Array<object>} transactions - semua transaksi (globalData), ATAU relatedTx (subset) -- hasilnya sama.
 * @param {string} accName
 * @param {object} deps
 * @param {(kategori: string, jenis: string) => {parentName?: string}} deps.getCategoryStyle
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @param {Date|null} [deps.start] - null = tanpa batas awal.
 * @param {Date|null} [deps.end] - null = tanpa batas akhir.
 * @returns {{ entries: Array<{label: string, val: number}>, top: {label: string, val: number}|null }}
 */
export function aggregateAccountExpenseByCategory(transactions, accName, { getCategoryStyle, parseTgl, start = null, end = null }) {
  const catMap = {};
  (transactions || []).forEach((d) => {
    if (d.jenis !== "Pengeluaran" || d.akun !== accName || !d.tanggal) return;
    if (start || end) {
      const date = parseTgl(d.tanggal);
      if (start && date < start) return;
      if (end && date > end) return;
    }
    const style = getCategoryStyle(d.kategori, "Pengeluaran");
    const pName = style.parentName || d.kategori;
    catMap[pName] = (catMap[pName] || 0) + Number(d.jumlah);
  });
  const entries = Object.keys(catMap).map((k) => ({ label: k, val: catMap[k] })).sort((a, b) => b.val - a.val);
  return { entries, top: entries[0] || null };
}

/**
 * Total bersih (masuk dikurangi keluar) SEKELOMPOK transaksi (mis. semua
 * transaksi di 1 tanggal yang sama) TERHADAP 1 akun -- dipakai utk badge
 * ringkasan per-hari di riwayat transaksi Detail Akun. Extracted dari
 * openAccountDetail().
 *
 * @param {Array<object>} rows - transaksi yang sudah difilter terkait `accName` (mis. 1 grup tanggal).
 * @param {string} accName
 * @param {object} deps
 * @param {(row: object) => number} deps.transferTargetAmount - nominal sisi tujuan transfer.
 * @returns {number} bisa negatif (net keluar) atau positif (net masuk).
 */
export function computeAccountGroupNet(rows, accName, { transferTargetAmount }) {
  let netTotal = 0;
  (rows || []).forEach((row) => {
    const isTransferIn = row.jenis === "Transfer" && row.kategori === accName;
    const isInflow = row.jenis === "Pemasukan" || isTransferIn;
    // BUG FIX (multi-currency transfer, dipertahankan dari kode asli): transfer MASUK ke
    // akun ini pakai transferTargetAmount() (nominal dlm mata uang akun ini sendiri),
    // bukan row.jumlah (nominal sisi sumber, mata uangnya bisa beda).
    const nominalUntukAkunIni = isTransferIn ? transferTargetAmount(row) : Number(row.jumlah);
    netTotal += (isInflow ? 1 : -1) * nominalUntukAkunIni;
  });
  return netTotal;
}
