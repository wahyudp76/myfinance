function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function comparableRows(rows) {
  return stable((rows || []).map((row) => ({
    id: row.id,
    jenis: row.jenis,
    tanggal: row.tanggal,
    jumlah: Number(row.jumlah),
    akun: row.akun,
    kategori: row.kategori,
    keterangan: row.keterangan,
    mata_uang: row.mata_uang ?? null,
    kurs: row.kurs != null ? Number(row.kurs) : null,
    jumlah_idr: row.jumlah_idr != null ? Number(row.jumlah_idr) : null,
    transfer_jumlah_tujuan: row.transfer_jumlah_tujuan != null ? Number(row.transfer_jumlah_tujuan) : null,
    transfer_mata_uang_tujuan: row.transfer_mata_uang_tujuan ?? null,
    transfer_kurs_tujuan: row.transfer_kurs_tujuan != null ? Number(row.transfer_kurs_tujuan) : null,
    transfer_jumlah_tujuan_idr: row.transfer_jumlah_tujuan_idr != null ? Number(row.transfer_jumlah_tujuan_idr) : null,
  })));
}

function rowKey(row) {
  return JSON.stringify(row);
}

export function compareTransactionLists(legacyRows, nativeRows) {
  const legacyComparable = comparableRows(legacyRows);
  const nativeComparable = comparableRows(nativeRows);
  const legacy = JSON.stringify(legacyComparable);
  const native = JSON.stringify(nativeComparable);

  return {
    equal: legacy === native,
    legacyCount: legacyRows?.length ?? 0,
    nativeCount: nativeRows?.length ?? 0,
    legacy,
    native,
    diagnostics: buildDiagnostics(legacyComparable, nativeComparable),
  };
}

function buildDiagnostics(legacyRows, nativeRows) {
  const nativeById = new Map(nativeRows.map((row) => [String(row.id), row]));
  const legacyById = new Map(legacyRows.map((row) => [String(row.id), row]));
  const missingInNative = [];
  const missingInLegacy = [];
  const fieldMismatches = [];

  for (const [id, legacy] of legacyById) {
    const native = nativeById.get(id);
    if (!native) {
      missingInNative.push(id);
      continue;
    }
    for (const field of ["jenis", "tanggal", "jumlah", "akun", "kategori", "keterangan", "mata_uang", "kurs", "jumlah_idr", "transfer_jumlah_tujuan", "transfer_mata_uang_tujuan", "transfer_kurs_tujuan", "transfer_jumlah_tujuan_idr"]) {
      if (rowKey(legacy[field]) !== rowKey(native[field])) {
        fieldMismatches.push({ id, field });
      }
    }
  }

  for (const id of nativeById.keys()) {
    if (!legacyById.has(id)) missingInLegacy.push(id);
  }

  return {
    missingInNative,
    missingInLegacy,
    fieldMismatches,
  };
}

export async function runTransactionReadParity({ legacyRead, nativeRead }) {
  const [legacy, native] = await Promise.all([legacyRead(), nativeRead()]);
  return compareTransactionLists(legacy, native);
}
