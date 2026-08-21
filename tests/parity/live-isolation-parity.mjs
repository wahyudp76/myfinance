import { createClient } from "@supabase/supabase-js";
import { createTransactionService } from "../../src/services/transactions.js";

if (process.env.RUN_LIVE_ISOLATION_PARITY !== "true") {
  console.log("Live isolation parity: SKIPPED (opt-in flag is not enabled)");
  process.exit(0);
}

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "PARITY_TEST_EMAIL", "PARITY_TEST_PASSWORD", "PARITY_ISOLATION_EMAIL", "PARITY_ISOLATION_PASSWORD"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required for live isolation parity.`);

const makeClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = makeClient();
const other = makeClient();
const ownerService = createTransactionService(owner);
const otherService = createTransactionService(other);
const createdIds = [];
const marker = `ISOLATION-PARITY-${Date.now()}`;

try {
  let result = await owner.auth.signInWithPassword({ email: process.env.PARITY_TEST_EMAIL, password: process.env.PARITY_TEST_PASSWORD });
  if (result.error) throw result.error;
  result = await other.auth.signInWithPassword({ email: process.env.PARITY_ISOLATION_EMAIL, password: process.env.PARITY_ISOLATION_PASSWORD });
  if (result.error) throw result.error;

  const created = await ownerService.create({
    jenis: "expense",
    tanggal: "2030-03-01",
    jumlah: 12345,
    akun: "PARITY",
    kategori: "PARITY",
    keterangan: marker,
    mata_uang: "IDR",
    kurs: 1,
    jumlah_idr: 12345,
  });
  if (!created?.id) throw new Error("Isolation parity seed did not return an id.");
  createdIds.push(created.id);

  const otherRows = await otherService.list();
  if (otherRows.some((row) => row.id === created.id || row.keterangan === marker)) {
    throw new Error("Isolation failure: another authenticated user can read the parity transaction.");
  }

  let updateBlocked = false;
  try {
    await otherService.update(created.id, { jenis: "income", tanggal: "2030-03-01", jumlah: 99999, akun: "PARITY", kategori: "PARITY", keterangan: marker, mata_uang: "IDR", kurs: 1, jumlah_idr: 99999 });
    updateBlocked = !(await ownerService.list()).some((row) => row.id === created.id && Number(row.jumlah) === 99999);
  } catch { updateBlocked = true; }
  if (!updateBlocked) throw new Error("Isolation failure: another authenticated user changed the transaction.");

  let deleteBlocked = false;
  try {
    await otherService.remove(created.id);
    deleteBlocked = (await ownerService.list()).some((row) => row.id === created.id);
  } catch { deleteBlocked = true; }
  if (!deleteBlocked) throw new Error("Isolation failure: another authenticated user deleted the transaction.");

  console.log("Live isolation parity: PASS (cross-user read/update/delete blocked)");
} finally {
  for (const id of createdIds) {
    try { await ownerService.remove(id); } catch (error) { console.error(`Isolation cleanup failed for ${id}: ${error.message}`); }
  }
  await Promise.allSettled([owner.auth.signOut(), other.auth.signOut()]);
}
