/**
 * Transfer service boundary.
 * Financial conversion belongs in the domain layer; atomic persistence belongs in Supabase RPC.
 */
import { convertCurrency } from "../../domain/finance.js";

function requireClient(client) {
  if (!client || typeof client.rpc !== "function") {
    throw new Error("Supabase client tidak tersedia.");
  }
  return client;
}

function requireText(value, name) {
  if (!value || !String(value).trim()) throw new Error(`${name} wajib diisi.`);
  return String(value).trim();
}

export function buildTransferPreview(input) {
  const sourceAmount = Number(input?.sourceAmount);
  const sourceCurrency = requireText(input?.sourceCurrency, "Mata uang sumber");
  const destinationCurrency = requireText(input?.destinationCurrency, "Mata uang tujuan");
  const sourceRate = Number(input?.sourceRateIdrPerUnit);
  const destinationRate = Number(input?.destinationRateIdrPerUnit);

  const result = convertCurrency({
    sourceAmount,
    sourceRate: { idrPerUnit: sourceRate },
    destinationRate: { idrPerUnit: destinationRate },
  });

  return {
    sourceAmount,
    sourceCurrency,
    destinationAmount: result.destinationAmount,
    destinationCurrency,
    sourceAmountIdr: result.sourceAmountIdr,
    destinationAmountIdr: result.destinationAmountIdr,
    sourceRateIdrPerUnit: sourceRate,
    destinationRateIdrPerUnit: destinationRate,
  };
}

export async function createTransfer(client, input) {
  const supabase = requireClient(client);
  const preview = buildTransferPreview(input);

  const { data, error } = await supabase.rpc("create_transfer_transaction", {
    p_tanggal: requireText(input.tanggal, "Tanggal"),
    p_jumlah: preview.sourceAmount,
    p_akun_sumber: requireText(input.sourceAccount, "Akun sumber"),
    p_akun_tujuan: requireText(input.destinationAccount, "Akun tujuan"),
    p_mata_uang_sumber: preview.sourceCurrency,
    p_mata_uang_tujuan: preview.destinationCurrency,
    p_kurs_sumber: preview.sourceRateIdrPerUnit,
    p_kurs_tujuan: preview.destinationRateIdrPerUnit,
    p_keterangan: input.description ? String(input.description) : null,
  });

  if (error) throw error;
  return { data, preview };
}
