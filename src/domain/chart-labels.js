/**
 * Utilitas chart label "sparse" (jarang) -- dipakai bareng oleh 3 chart bar
 * berbeda (Tren Transaksi di tab Riwayat Transaksi, Tren Saldo/Arus Kas di
 * Detail Akun, Tren Kategori di Detail Kategori) untuk membatasi jumlah
 * angka yang ditampilkan LANGSUNG di atas batang ketika batangnya banyak &
 * sempit, supaya tidak numpuk/tumpang-tindih. Batang yang tidak kepilih
 * tetap ada, cuma tanpa angka di atasnya -- detail nilainya tetap bisa
 * dilihat lewat tap (tooltip Chart.js).
 *
 * Pure functions only: no DOM/Chart.js access -- pemanggil yang membaca
 * `clientWidth` container & memasang hasilnya ke opsi `datalabels.display`
 * Chart.js.
 *
 * UNIFIKASI (bukan sekadar pemindahan): sebelumnya algoritma pemilihan
 * indeksnya sama persis di-copy-paste 3x, tapi CARA MENENTUKAN "chart-nya
 * sempit atau tidak?" beda-beda dgn 1 versi yang py bug: 2 dari 3 tempat
 * masih mengecek `window.innerWidth < 640` (lebar JENDELA), padahal lebar
 * CANVAS chart itu sendiri bisa jauh lebih sempit dari window (mis. duduk
 * di kolom grid, atau window lebar tapi jumlah batang banyak sekali hingga
 * tiap batang cuma dapat sedikit px). Baru 1 tempat (Detail Akun) yang
 * sudah diperbaiki pakai lebar CONTAINER dibagi jumlah batang. Sekarang
 * ketiganya pakai isChartNarrow() yang sama (berbasis container width),
 * jadi PERILAKU 2 chart yang tadinya buggy ITU BERUBAH (chart di layar
 * lebar dgn banyak batang yang tadinya kepaksa nampilin semua label kini
 * ikut dibatasi) -- ini keputusan fix yang disengaja, bukan efek samping.
 */

/**
 * Apakah chart cukup sempit (px per batang di bawah ambang) sehingga label
 * perlu dibatasi. `containerWidthPx` HARUS `clientWidth` elemen pembungkus
 * canvas (bukan `window.innerWidth`) supaya akurat di layout apapun
 * (grid berkolom, modal, dst).
 *
 * @param {number} containerWidthPx
 * @param {number} bucketCount - jumlah batang/titik data.
 * @param {number} [minPxPerBucket] - default 60, dipertahankan dari
 *   implementasi pertama (Detail Akun) yang jadi rujukan unifikasi ini.
 * @returns {boolean}
 */
export function isChartNarrow(containerWidthPx, bucketCount, minPxPerBucket = 60) {
  const pxPerBucket = bucketCount > 0 ? containerWidthPx / bucketCount : Infinity;
  return pxPerBucket < minPxPerBucket;
}

/**
 * Pilih indeks batang mana saja yang dikasih label, dari yang PALING
 * SIGNIFIKAN (nilai absolut terbesar) dulu, dengan jarak minimal antar
 * indeks terpilih (supaya 2 batang bersebelahan tidak sama-sama kepilih
 * lalu tetap numpuk). Batang bernilai 0 tidak pernah dipilih.
 *
 * Utk chart dgn LEBIH DARI 1 dataset per titik (mis. Masuk & Keluar),
 * pemanggil menjumlah `Math.abs(datasetA[i]) + Math.abs(datasetB[i])` dulu
 * jadi 1 array magnitudes sebelum memanggil ini -- lihat contoh Detail Akun.
 *
 * @param {number[]} magnitudes - 1 angka per batang (boleh negatif; nilai
 *   absolutnya yang dipakai membandingkan signifikansi).
 * @param {number} maxLabelCount
 * @returns {Set<number>} indeks (0-based) yang perlu ditampilkan labelnya.
 */
export function selectSparseLabelIndices(magnitudes, maxLabelCount) {
  const len = magnitudes.length;
  const minIndexGap = Math.max(2, Math.floor(len / (maxLabelCount + 1)));
  const candidates = magnitudes
    .map((v, i) => ({ v: Math.abs(v), i }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);

  const chosen = [];
  for (const item of candidates) {
    if (chosen.length >= maxLabelCount) break;
    if (chosen.every((idx) => Math.abs(idx - item.i) >= minIndexGap)) chosen.push(item.i);
  }
  return new Set(chosen);
}

/**
 * Varian utk chart BANYAK DATASET per titik (mis. bar Masuk & Keluar): pilih
 * bucket yang sama seperti selectSparseLabelIndices (peringkat by TOTAL
 * magnitudo semua dataset), lalu di tiap bucket terpilih HANYA dataset
 * DOMINAN (nilai absolut terbesar, > 0) yang boleh menaruh angka.
 *
 * Mengapa: dua angka berdampingan di atas sepasang batang selebar ~10-14px
 * (rentang 30 hari) SALING MENIMPA -- teks "844K" (±22px @font 8) lebih lebar
 * dari satu bucket utuh. Satu angka dominan per bucket = "beberapa angka
 * saja" yang tetap terbaca; nilai satunya tetap ada di tooltip (tap batang).
 *
 * Tie-break deterministik: dataset indeks terkecil menang (perbandingan
 * strict >). Bucket bernilai 0 semua tidak pernah terpilih (filter di
 * selectSparseLabelIndices), jadi `best` selalu valid utk bucket terpilih.
 *
 * @param {number[][]} seriesByDataset - 1 array angka per dataset, sejajar
 *   per indeks bucket (boleh ada null/undefined di dalamnya).
 * @param {number} maxLabelCount
 * @returns {Map<number, number>} bucketIndex -> datasetIndex dominan.
 */
export function selectSparseLabelCells(seriesByDataset, maxLabelCount) {
  const datasets = (Array.isArray(seriesByDataset) ? seriesByDataset : []).filter(Array.isArray);
  const cells = new Map();
  if (!datasets.length) return cells;

  const bucketCount = datasets.reduce((n, s) => Math.max(n, s.length), 0);
  const magnitudes = [];
  for (let i = 0; i < bucketCount; i++) {
    let sum = 0;
    for (const s of datasets) sum += Math.abs(Number(s[i]) || 0);
    magnitudes.push(sum);
  }

  for (const i of selectSparseLabelIndices(magnitudes, maxLabelCount)) {
    let bestDataset = -1, bestVal = 0;
    datasets.forEach((s, d) => {
      const v = Math.abs(Number(s[i]) || 0);
      if (v > 0 && v > bestVal) { bestVal = v; bestDataset = d; }
    });
    if (bestDataset >= 0) cells.set(i, bestDataset);
  }
  return cells;
}
