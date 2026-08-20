/**
 * Converts the existing UI transaction shape into the canonical Supabase service input.
 * This adapter deliberately contains no database calls.
 */

const ALLOWED_TYPES = new Set(["Pemasukan", "Pengeluaran", "Transfer"]);

export function toCanonicalTransaction(input) {
  const jenis = String(input?.jenis || "").trim();
  if (!ALLOWED_TYPES.has(jenis)) throw new Error("Jenis transaksi tidak valid.");

  const jumlah = Number(input?.jumlah);
  if (!Number.isFinite(jumlah) || jumlah <= 0) throw new Error("Jumlah transaksi harus lebih dari 0.");

  const tanggal = String(input?.tanggal || "").trim();
  const akun = String(input?.akun || "").trim();
  const kategori = String(input?.kategori || "").trim();

  if (!tanggal) throw new Error("Tanggal wajib diisi.");
  if (!akun) throw new Error("Akun wajib diisi.");
  if (!kategori) throw new Error("Kategori wajib diisi.");

  return {
    tanggal,
    jumlah,
    akun,
    kategori,
    jenis,
    keterangan: input?.keterangan ? String(input.keterangan).trim() : null,
  };
}

export function fromCanonicalTransaction(row) {
  return {
    ...row,
    jumlah: Number(row?.jumlah ?? 0),
  };
}
