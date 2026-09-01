/**
 * MyFinance asset cash-flow domain (setor/tarik dana akun <-> aset, mis. Bibit).
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 *
 * Mekanisme "Setor ke Aset" di pencatatan transaksi:
 *  - Transaksi dicatat sebagai baris `jenis: 'Transfer'` dengan `akun` = rekening
 *    sumber dan `kategori` = NAMA ASET tujuan. Saldo rekening sumber otomatis
 *    berkurang lewat logika transfer yang sudah ada (src/domain/accounts.js,
 *    dashboard.js, dsb), dan karena nama aset bukan nama akun, tidak ada akun
 *    tujuan yang bertambah -- kekayaan bersih tetap (uang hanya pindah wadah).
 *  - Sisi aset: `nilai` dan `modal` bertambah sebesar jumlah setor (setoran =
 *    tambahan cost basis), dan satu titik `value_history` di-upsert pada tanggal
 *    transaksi supaya grafik riwayat aset ikut bergerak.
 *  - Edit transaksi setor -> delta (jumlah baru - jumlah lama) diterapkan ke aset.
 *  - Hapus transaksi setor -> jumlah ditarik kembali dari aset (jumlah negatif).
 */

/**
 * Terapkan setoran (jumlah > 0) atau penarikan/pembalikan (jumlah < 0) ke aset.
 * @param {object} asset - baris aset minimal { nilai, modal, value_history }.
 * @param {number} jumlah - nominal setor (positif) atau delta/pembalikan (negatif).
 * @param {string|null} tanggal - 'YYYY-MM-DD' titik riwayat; null = riwayat tidak disentuh.
 * @returns {{ modal: number, nilai: number, value_history: Array<{tanggal: string, nilai: number}> }}
 *   field siap-merge untuk updateAsset() (spread ke baris aset yang ada).
 */
export function applyAssetDeposit(asset, jumlah, tanggal) {
  const jumlahNum = Number(jumlah) || 0;
  const nilaiBaru = Math.max(0, Number(asset && asset.nilai) + jumlahNum);
  const modalBaru = Math.max(0, Number(asset && asset.modal) + jumlahNum);

  const history = Array.isArray(asset && asset.value_history)
    ? asset.value_history.filter((h) => h && typeof h === "object").map((h) => ({ tanggal: h.tanggal, nilai: Number(h.nilai) || 0 }))
    : [];

  const tgl = typeof tanggal === "string" && tanggal.length >= 10 ? tanggal.slice(0, 10) : null;
  if (tgl) {
    const idx = history.findIndex((h) => typeof h.tanggal === "string" && h.tanggal.slice(0, 10) === tgl);
    if (idx >= 0) history[idx] = { tanggal: tgl, nilai: nilaiBaru };
    else history.push({ tanggal: tgl, nilai: nilaiBaru });
    history.sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  }

  return { modal: modalBaru, nilai: nilaiBaru, value_history: history };
}

/** Cari aset berdasarkan nama (case-insensitive, trim). Return null bila tak ada. */
export function findAssetByName(assets, nama) {
  if (!Array.isArray(assets) || !nama) return null;
  const target = String(nama).trim().toLowerCase();
  if (!target) return null;
  return assets.find((a) => a && String(a.nama || "").trim().toLowerCase() === target) || null;
}

/**
 * Tentukan apakah sebuah baris transaksi adalah "setor ke aset": jenis Transfer
 * dengan kategori = nama aset yang dikenal. Dipakai utk prefill edit, pembalikan
 * saat hapus, dan guard "jangan daftarkan nama aset sebagai akun baru".
 */
export function resolveAssetDepositTx(tx, assets) {
  if (!tx || tx.jenis !== "Transfer") return null;
  return findAssetByName(assets, tx.kategori);
}

/**
 * Self-healing bug "nama aset terbaca sebagai akun" (kasus: aset "shopee merchant"
 * dibeli lewat pencatatan transfer ke aset, lalu muncul di daftar rekening).
 *
 * Akar masalah historis: nama tujuan Transfer pernah didaftarkan sebagai akun
 * SEBELUM asetnya ada (atau saat globalAssets belum termuat), dan tidak ada jalur
 * yang membuangnya kembali. Fungsi ini mengembalikan nama-nama di `accounts` yang
 * sebenarnya BAYANGAN aset -- dengan aturan ketat supaya tidak pernah menyentuh
 * akun sungguhan:
 *   1. nama cocok (trim+lowercase) dengan salah satu aset, DAN
 *   2. TIDAK ADA transaksi yang memakainya sebagai `akun` (akun sah pasti pernah
 *      jadi sumber/penerima dana), DAN
 *   3. ADA transaksi jenis Transfer yang memakainya sebagai `kategori`
 *      (jejak khas setor-dana-ke-aset).
 * Murni: tidak memutasi apa pun; pemanggil yang menyaring `accounts`.
 */
export function pruneAssetShadowAccounts({ accounts, transactions, assets } = {}) {
  const acc = Array.isArray(accounts) ? accounts : [];
  const txs = Array.isArray(transactions) ? transactions : [];
  const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const removed = [];
  for (const name of acc) {
    const n = norm(name);
    if (!n) continue;
    if (!findAssetByName(assets, name)) continue;
    const usedAsAccount = txs.some((t) => norm(t && t.akun) === n);
    if (usedAsAccount) continue;
    const shadowOfSetor = txs.some(
      (t) => t && String(t.jenis) === "Transfer" && norm(t.kategori) === n,
    );
    if (shadowOfSetor) removed.push(name);
  }
  return removed;
}

/**
 * Sinkronisasi daftar akun dari baris transaksi: setiap akun yang dipakai
 * transaksi (baris .akun, atau kategori tujuan Transfer yang bukan nama aset
 * yang dikenal) didaftarkan bila belum ada, lalu self-heal "nama aset bayangan"
 * dijalankan (pruneAssetShadowAccounts). Dipakai refreshTransactionsOnly() DAN
 * echo lokal pasca-simpan (applyLocalTxEcho di index.html) supaya keduanya
 * memakai logika yang sama persis.
 *
 * Murni & tanpa efek samping -- mengembalikan daftar akun baru + nama yang baru
 * ditambahkan + nama bayangan yang perlu dipangkas (pemanggil yang memutuskan
 * kapan persistSettings/renderSettings dijalankan).
 *
 * @returns {{ accounts: string[], added: string[], shadowNames: string[] }}
 */
export function syncAccountsFromTransactions({ accounts, transactions, assets } = {}) {
  let result = Array.isArray(accounts) ? accounts.slice() : [];
  const added = [];
  const txs = Array.isArray(transactions) ? transactions : [];
  const assetList = Array.isArray(assets) ? assets : [];

  for (const row of txs) {
    if (row.akun && !result.includes(row.akun)) {
      result.push(row.akun);
      added.push(row.akun);
    }
    // Nama aset tujuan setor (mis. Bibit) BUKAN akun -- jangan didaftarkan otomatis.
    if (row.jenis === "Transfer" && row.kategori && !result.includes(row.kategori) && !findAssetByName(assetList, row.kategori)) {
      result.push(row.kategori);
      added.push(row.kategori);
    }
  }

  // Self-heal "shopee merchant" (lihat pruneAssetShadowAccounts) -- dipakai di
  // refresh penuh dan echo lokal sama-sama, supaya hasilnya tidak pernah beda.
  const shadowNames = pruneAssetShadowAccounts({ accounts: result, transactions: txs, assets: assetList });
  if (shadowNames.length) {
    result = result.filter((n) => !shadowNames.includes(n));
  }

  return { accounts: result, added, shadowNames };
}
