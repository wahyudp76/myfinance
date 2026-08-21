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
  })));
}

export function compareTransactionLists(legacyRows, nativeRows) {
  const legacy = JSON.stringify(comparableRows(legacyRows));
  const native = JSON.stringify(comparableRows(nativeRows));
  return {
    equal: legacy === native,
    legacyCount: legacyRows?.length ?? 0,
    nativeCount: nativeRows?.length ?? 0,
    legacy,
    native,
  };
}

export async function runTransactionReadParity({ legacyRead, nativeRead }) {
  const [legacy, native] = await Promise.all([legacyRead(), nativeRead()]);
  return compareTransactionLists(legacy, native);
}
