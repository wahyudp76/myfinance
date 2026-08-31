/**
 * Sparkline HUD -- domain logic murni (tanpa DOM/Chart/Supabase).
 *
 * Dipakai dashboard (kartu hero) untuk menggambar gelombang neon tren keuangan
 * singkat (pemasukan / pengeluaran / arus kas bersih per hari). Semua fungsi
 * deterministik: `today` bisa disuntik supaya bisa diuji unit tanpa clock asli.
 *
 * Kontrak bentuk data transaksi mengikuti tabel `transactions`:
 *   { tanggal: 'YYYY-MM-DD', jenis: 'Pemasukan'|'Pengeluaran'|'Transfer', jumlah }
 * Transfer TIDAK dihitung (hanya memindahkan uang antar akun).
 */

/** 'YYYY-MM-DD' dari Date lokal (bukan UTC -- transaksi dicatat tanggal lokal). */
export function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Agregat arus kas per hari untuk `days` hari terakhir (berakhir di `today`).
 * @returns {{key:string,in:number,out:number,net:number}[]} urut lama -> baru.
 */
export function buildDailyFlow(rows, { days = 14, today } = {}) {
  const n = Number.isFinite(days) && days > 0 ? Math.floor(days) : 14;
  const end = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
  const buckets = new Map();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    buckets.set(toLocalDateKey(d), { in: 0, out: 0 });
  }
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || typeof r.tanggal !== "string") return;
    const key = r.tanggal.slice(0, 10);
    const b = buckets.get(key);
    if (!b) return;
    const amount = Math.abs(Number(r.jumlah) || 0);
    if (r.jenis === "Pemasukan") b.in += amount;
    else if (r.jenis === "Pengeluaran") b.out += amount;
  });
  return [...buckets.entries()].map(([key, v]) => ({
    key, in: v.in, out: v.out, net: v.in - v.out,
  }));
}

/**
 * Geometri jalur sparkline (koordinat SVG, y=0 di atas).
 * Nilai seragam/kosong -> garis datar di tengah (bukan NaN).
 * @returns {{line:string, area:string, last:{x:number,y:number}|null, width:number, height:number}}
 */
export function sparklineGeometry(values, { width = 96, height = 26, pad = 3 } = {}) {
  const w = Number.isFinite(width) && width > 0 ? width : 96;
  const h = Number.isFinite(height) && height > 0 ? height : 26;
  const p = Number.isFinite(pad) && pad >= 0 ? pad : 3;
  const vals = (Array.isArray(values) ? values : []).map((v) => Number(v) || 0);
  if (vals.length === 0) {
    const y = h / 2;
    return { line: `M 0 ${y} L ${w} ${y}`, area: `M 0 ${y} L ${w} ${y} L ${w} ${h} L 0 ${h} Z`, last: null, width: w, height: h };
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min;
  const usableH = Math.max(h - p * 2, 1);
  const stepX = vals.length > 1 ? (w - p * 2) / (vals.length - 1) : 0;
  const pts = vals.map((v, i) => {
    const x = vals.length > 1 ? p + i * stepX : w / 2;
    const y = span === 0 ? h / 2 : p + (1 - (v - min) / span) * usableH;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  });
  const line = pts.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`).join(" ");
  const area = `${line} L ${pts[pts.length - 1].x} ${h} L ${pts[0].x} ${h} Z`;
  return { line, area, last: pts[pts.length - 1], width: w, height: h };
}

/**
 * String <svg> sparkline neon (siap innerHTML). Gradasi transparan di bawah
 * garis + titik ujung bercahaya -- efek glow pakai drop-shadow inline (aman
 * tanpa CSS eksternal). `id` harus unik per instance (dipakai id gradient).
 */
export function sparklineSvg(values, { stroke = "#22d3ee", width = 96, height = 26, id = "spark" } = {}) {
  const g = sparklineGeometry(values, { width, height });
  const gid = `hud-spark-${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const dot = g.last
    ? `<circle cx="${g.last.x}" cy="${g.last.y}" r="2" fill="${stroke}" style="filter:drop-shadow(0 0 4px ${stroke})"/>`
    : "";
  return (
    `<svg width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" fill="none" aria-hidden="true">` +
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${stroke}" stop-opacity="0.38"/>` +
    `<stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${g.area}" fill="url(#${gid})"/>` +
    `<path d="${g.line}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 3px ${stroke})"/>` +
    dot +
    `</svg>`
  );
}
