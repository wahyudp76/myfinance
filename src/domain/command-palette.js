/**
 * MyFinance domain: indeks & pencarian COMMAND PALETTE (Tier-3 #9, Ctrl+K).
 *
 * Murni: pembangunan indeks dari state app (views/kategori/akun/transaksi)
 * + pencarian berperingkat. Controller DOM & keyboard ada di index.html
 * (modal #modalPalette memakai infra focus-trap/Esc modal-a11y otomatis).
 */
export const PALETTE_TYPE = { VIEW: "view", CATEGORY: "category", ACCOUNT: "account", TRANSACTION: "transaction" };

/**
 * Bangun indeks perintah.
 * @param {object} p
 * @param {Array<{name:string,label:string}>} p.views - navigasi (switchView).
 * @param {object} p.categoryDict - { pengeluaran: {...}, pemasukan: {...} } (parents dipakai).
 * @param {string[]} p.accounts - nama akun (appSettings.accounts).
 * @param {Array<object>} p.transactions - globalData (terbaru dulu TIDAK diurut di sini;
 *   pemanggil memotong N terbaru, lihat buildCommandIndex caller di index.html).
 */
export function buildCommandIndex({ views = [], categoryDict = {}, accounts = [], transactions = [] } = {}) {
  const idx = [];
  views.forEach((v) => idx.push({ type: PALETTE_TYPE.VIEW, id: "view:" + v.name, label: v.label, sub: "Navigasi", view: v.name }));

  const TYPE_LABEL = { pengeluaran: "Kategori Pengeluaran", pemasukan: "Kategori Pemasukan" };
  Object.keys(TYPE_LABEL).forEach((jenisKey) => {
    const dict = categoryDict && categoryDict[jenisKey];
    if (!dict) return;
    Object.keys(dict).forEach((name) => {
      // Nama jenis bentuk tampilan ('Pemasukan'/'Pengeluaran') mengikuti konvensi app.
      idx.push({ type: PALETTE_TYPE.CATEGORY, id: "cat:" + jenisKey + ":" + name, label: name, sub: TYPE_LABEL[jenisKey], catName: name, jenis: jenisKey === "pemasukan" ? "Pemasukan" : "Pengeluaran" });
    });
  });

  accounts.forEach((a) => idx.push({ type: PALETTE_TYPE.ACCOUNT, id: "acc:" + a, label: a, sub: "Akun", accountName: a }));

  transactions.forEach((t, i) => {
    const label = t.keterangan || t.kategori || "(tanpa nama)";
    idx.push({ type: PALETTE_TYPE.TRANSACTION, id: "tx:" + (t.id != null ? t.id : i), label, sub: `${t.tanggal || ""} • ${t.akun || ""} • ${t.kategori || ""}`.replace(/^[ •]+|[ •]+$/g, ""), searchText: label + " " + (t.kategori || "") + " " + (t.akun || ""), tx: t });
  });
  return idx;
}

/**
 * Cari perintah. Query kosong -> hanya navigasi (pintasan). Skor: label
 * diawali kata (3) > label mengandung (2) > sub/searchText mengandung (1).
 * Hasil terurut skor menurun lalu urutan indeks (stabil, deterministik).
 */
export function searchCommands(index, query, { limit = 10 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return index.filter((c) => c.type === PALETTE_TYPE.VIEW).slice(0, limit);
  const scored = [];
  index.forEach((c, order) => {
    const label = c.label.toLowerCase();
    let score = 0;
    if (label.startsWith(q)) score = 3;
    else if (label.includes(q)) score = 2;
    else if ((c.sub || "").toLowerCase().includes(q) || (c.searchText || "").toLowerCase().includes(q)) score = 1;
    if (score > 0) scored.push({ c, score, order });
  });
  scored.sort((a, b) => (b.score - a.score) || (a.order - b.order));
  return scored.slice(0, limit).map((s) => s.c);
}
