// Parser SQL kecil. SATU sumber kebenaran untuk tiga pemakai:
//   * tests/unit/docs-consistency.test.js        (hitung tabel/RPC/fungsi trigger)
//   * tests/unit/sql-schema-completeness.test.js (guard kolom + kontrak tipe)
//   * scripts/schema-verify/drift-check.mjs      (pembanding katalog live-vs-repo)
// Kalau definisinya beda-beda, guard dan alat drift bisa saling bertentangan.
//
// Letaknya di scripts/ (bukan tests/unit/helpers/) karena drift-check.mjs juga
// membutuhkannya, dan arah impor tests -> scripts sudah jadi kebiasaan repo
// (lihat tests/unit/csp-hash.test.js yang mengimpor scripts/build-csp.mjs).
//
// KENAPA BUKAN REGEX BIASA (pelajaran v124, audit drift live-vs-repo 2026-09-13):
// percobaan pertama menghitung function dengan /\)\s*\nreturns\s+(\w+)/ dan
// GAGAL, karena komentar di dalam arg-list create_transfer_transaction memuat
// tanda ")" (contoh: coalesce(p_kurs_sumber, 1)). Pencocokan non-greedy berhenti
// di kurung yang salah. Aturan yang sama sudah berlaku untuk registry aksi UI di
// docs-consistency.test.js: untuk struktur bersarang, pakai pencocokan kurung,
// bukan regex.
//
// Urutan kerja tiap fungsi: buang komentar (dengan menghormati literal string,
// supaya "--" dan kurung di dalam komentar tidak ikut terhitung) -> pindai kurung
// seimbang -> baca token setelahnya.

/**
 * Buang komentar SQL (`--` sampai akhir baris, dan blok `/* ... *\/`) tanpa
 * menyentuh isi literal string. Kutip ganda ('') di dalam string diperlakukan
 * sebagai escape, sesuai aturan PostgreSQL.
 *
 * Baris baru dari komentar `--` DIPERTAHANKAN supaya nomor baris tetap berarti
 * kalau pesan error perlu menunjuk ke teks aslinya.
 *
 * @param {string} src
 * @returns {string}
 */
export function stripSqlComments(src) {
  let out = "";
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (c === "'") {
        if (src[i + 1] === "'") { out += "'"; i++; }
        else inString = false;
      }
      continue;
    }
    if (c === "'") { inString = true; out += c; continue; }
    if (c === "-" && src.startsWith("--", i)) {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (src.startsWith("/*", i)) {
      const j = src.indexOf("*/", i + 2);
      i = j === -1 ? src.length : j + 1;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Dari indeks tepat SETELAH "(" pembuka, maju sampai kurung penutup pasangannya.
 * @param {string} s teks (sudah bebas komentar)
 * @param {number} start indeks tepat setelah "(" pembuka
 * @returns {number} indeks karakter tepat setelah ")" penutup, atau -1
 */
function skipBalancedParens(s, start) {
  let depth = 1;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "'") {
        if (s[i + 1] === "'") i++;
        else inString = false;
      }
      continue;
    }
    if (c === "'") { inString = true; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Pecah isi kurung menjadi butir-butir tingkat atas (koma di kedalaman 0). */
function splitTopLevel(s) {
  const items = [];
  let depth = 0;
  let inString = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      cur += c;
      if (c === "'") {
        if (s[i + 1] === "'") { cur += "'"; i++; }
        else inString = false;
      }
      continue;
    }
    if (c === "'") { inString = true; cur += c; continue; }
    if (c === "(") { depth++; cur += c; continue; }
    if (c === ")") { depth--; cur += c; continue; }
    if (c === "," && depth === 0) { items.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) items.push(cur);
  return items;
}

const TABLE_CONSTRAINT_RE = /^\s*(constraint\b|primary\s+key\b|unique\b|check\b|foreign\s+key\b|exclude\b)/i;

/**
 * Parse semua `create table if not exists` plus `alter table ... add column if
 * not exists` menjadi model tabel -> kolom -> definisi mentah.
 *
 * @param {string} sql isi berkas (komentar TIDAK perlu dibuang dulu)
 * @returns {Map<string, {columns: Map<string,string>, tableConstraints: string[]}>}
 */
export function parseTables(sql) {
  const clean = stripSqlComments(sql);
  const tables = new Map();
  const ensure = (name) => {
    if (!tables.has(name)) tables.set(name, { columns: new Map(), tableConstraints: [] });
    return tables.get(name);
  };

  const createRe = /create\s+table\s+if\s+not\s+exists\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
  let m;
  while ((m = createRe.exec(clean)) !== null) {
    const name = m[1];
    const afterOpen = m.index + m[0].length;
    const afterClose = skipBalancedParens(clean, afterOpen);
    if (afterClose === -1) {
      throw new Error(`kurung create table ${name} tidak seimbang -- parser rusak`);
    }
    const body = clean.slice(afterOpen, afterClose - 1);
    const t = ensure(name);
    for (const raw of splitTopLevel(body)) {
      const item = raw.trim().replace(/\s+/g, " ");
      if (!item) continue;
      if (TABLE_CONSTRAINT_RE.test(item)) { t.tableConstraints.push(item); continue; }
      const cm = item.match(/^([a-z0-9_]+)\s+(.*)$/i);
      if (cm) t.columns.set(cm[1], cm[2]);
    }
  }

  // Kolom yang ditambahkan belakangan lewat ALTER TABLE (pola yang dipakai
  // berkas migrasi, dan juga schema.sql untuk kolom multi-currency).
  const alterRe = /alter\s+table\s+(?:public\.)?([a-z0-9_]+)\s+add\s+column\s+if\s+not\s+exists\s+([a-z0-9_]+)([^;]*)/gis;
  while ((m = alterRe.exec(clean)) !== null) {
    ensure(m[1]).columns.set(m[2], m[3].trim().replace(/\s+/g, " "));
  }

  return tables;
}

/**
 * Parse semua `create or replace function public.<nama>(...) returns <tipe>`.
 *
 * @param {string} sql
 * @returns {{name: string, returns: string|null, isTrigger: boolean}[]}
 */
export function parseSqlFunctions(sql) {
  const clean = stripSqlComments(sql);
  const found = [];
  const re = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const afterClose = skipBalancedParens(clean, m.index + m[0].length);
    if (afterClose === -1) {
      throw new Error(`kurung argumen function ${m[1]} tidak seimbang -- parser rusak`);
    }
    const rm = clean.slice(afterClose, afterClose + 160).match(/^\s*returns\s+([\w.]+)/i);
    const returns = rm ? rm[1] : null;
    found.push({
      name: m[1],
      returns,
      // trigger / event_trigger tidak bisa dipanggil lewat PostgREST, jadi bukan
      // RPC. Inilah pembeda yang dibutuhkan klaim "4 RPC" di dokumen.
      isTrigger: /^(?:public\.)?(?:event_)?trigger$/i.test(returns || ""),
    });
  }
  return found;
}

/**
 * Nama index yang dibuat berkas SQL (`create [unique] index if not exists`).
 * @param {string} sql
 * @returns {Set<string>}
 */
export function parseIndexNames(sql) {
  const clean = stripSqlComments(sql);
  return new Set([...clean.matchAll(/create\s+(?:unique\s+)?index\s+if\s+not\s+exists\s+([a-z0-9_]+)/gi)].map((m) => m[1]));
}

/**
 * Nama trigger yang dibuat berkas SQL (`create trigger <nama>`).
 * @param {string} sql
 * @returns {Set<string>}
 */
export function parseTriggerNames(sql) {
  const clean = stripSqlComments(sql);
  return new Set([...clean.matchAll(/create\s+trigger\s+([a-z0-9_]+)/gi)].map((m) => m[1]));
}

/**
 * Nama CHECK constraint bernama yang dideklarasikan berkas SQL, baik inline
 * (`constraint <nama> check (...)`) maupun lewat ALTER TABLE.
 * @param {string} sql
 * @returns {Set<string>}
 */
export function parseCheckConstraintNames(sql) {
  const clean = stripSqlComments(sql);
  const names = new Set();
  for (const m of clean.matchAll(/constraint\s+([a-z0-9_]+)\s+check\s*\(/gi)) names.add(m[1]);
  for (const m of clean.matchAll(/add\s+constraint\s+([a-z0-9_]+)\s*\n?\s*check\s*\(/gi)) names.add(m[1]);
  return names;
}
