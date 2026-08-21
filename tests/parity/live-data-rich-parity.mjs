import { createClient } from "@supabase/supabase-js";
import { createTransactionService } from "../../src/services/transactions.js";

const enabled = process.env.RUN_LIVE_DATA_RICH_PARITY === "true";
if (!enabled) {
  console.log("Live data-rich parity: SKIPPED (opt-in flag is not enabled)");
  process.exit(0);
}

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const email = process.env.PARITY_TEST_EMAIL;
const password = process.env.PARITY_TEST_PASSWORD;

for (const [name, value] of Object.entries({ SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: anonKey, PARITY_TEST_EMAIL: email, PARITY_TEST_PASSWORD: password })) {
  if (!value) throw new Error(`${name} is required for live data-rich parity.`);
}

const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const service = createTransactionService(client);
const createdIds = [];
const runId = `PARITY-${Date.now()}`;

const dataset = [
  { jenis: "income", tanggal: "2030-01-02", jumlah: 500000, akun: "PARITY", kategori: "PARITY", keterangan: `${runId}-IDR-IN`, mata_uang: "IDR", kurs: 1, jumlah_idr: 500000 },
  { jenis: "expense", tanggal: "2030-01-03", jumlah: 125000, akun: "PARITY", kategori: "PARITY", keterangan: `${runId}-IDR-OUT`, mata_uang: "IDR", kurs: 1, jumlah_idr: 125000 },
  { jenis: "expense", tanggal: "2030-01-04", jumlah: 10.5, akun: "PARITY", kategori: "PARITY", keterangan: `${runId}-USD-OUT`, mata_uang: "USD", kurs: 16000, jumlah_idr: 168000 },
  { jenis: "income", tanggal: "2030-01-05", jumlah: 25, akun: "PARITY", kategori: "PARITY", keterangan: `${runId}-USD-IN`, mata_uang: "USD", kurs: 16000, jumlah_idr: 400000 },
];

async function cleanup() {
  for (const id of createdIds) {
    try { await service.remove(id); } catch (error) { console.error(`Parity cleanup failed for created record ${id}:`, error.message); }
  }
}

try {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;

  for (const row of dataset) {
    const created = await service.create(row);
    if (!created?.id) throw new Error("Seeded transaction did not return an id.");
    createdIds.push(created.id);
  }

  const nativeRows = await service.list();
  const expected = dataset.map(({ keterangan, ...row }) => ({ ...row, id: expectId(keterangan, nativeRows) }));
  const actual = nativeRows.filter((row) => typeof row.keterangan === "string" && row.keterangan.startsWith(runId));

  if (actual.length !== dataset.length) {
    throw new Error(`Live data-rich parity seed read mismatch: expected ${dataset.length} rows, observed ${actual.length}.`);
  }

  for (const row of dataset) {
    const found = actual.find((candidate) => candidate.keterangan === row.keterangan);
    if (!found) throw new Error(`Seeded transaction not found: ${row.keterangan}`);
    for (const field of ["jenis", "tanggal", "jumlah", "akun", "kategori", "mata_uang", "kurs", "jumlah_idr"]) {
      if (String(found[field] ?? null) !== String(row[field] ?? null)) {
        throw new Error(`Live data-rich parity mismatch for ${row.keterangan}: ${field}`);
      }
    }
  }

  console.log(`Live data-rich parity: PASS (${actual.length} seeded rows verified)`);
} finally {
  await cleanup();
  await client.auth.signOut();
}

function expectId(key, rows) {
  const row = rows.find((candidate) => candidate.keterangan === key);
  return row?.id ?? null;
}
