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
const marker = `${runId}-`;

const dataset = Array.from({ length: 1005 }, (_, index) => {
  const n = index + 1;
  const currency = n % 3 === 0 ? "USD" : "IDR";
  const amount = currency === "USD" ? 10 + (n % 7) / 10 : 100000 + n;
  const rate = currency === "USD" ? 16000 : 1;
  return {
    jenis: n % 2 === 0 ? "expense" : "income",
    tanggal: `2030-02-${String((n % 28) + 1).padStart(2, "0")}`,
    jumlah: amount,
    akun: "PARITY",
    kategori: "PARITY",
    keterangan: `${marker}${String(n).padStart(4, "0")}`,
    mata_uang: currency,
    kurs: rate,
    jumlah_idr: amount * rate,
  };
});

async function cleanup() {
  const failures = [];
  for (const id of createdIds) {
    try { await service.remove(id); } catch (error) { failures.push(`${id}: ${error.message}`); }
  }
  if (failures.length) throw new Error(`Parity cleanup failed for ${failures.length} records. ${failures.slice(0, 3).join("; ")}`);
}

async function assertCleanup() {
  const remaining = (await service.list()).filter((row) => typeof row.keterangan === "string" && row.keterangan.startsWith(marker));
  if (remaining.length) throw new Error(`Parity cleanup verification failed: ${remaining.length} seeded rows remain visible.`);
}

// KENAPA ADA `primaryError`: sebelumnya blok finally di bawah langsung
// `throw cleanupError`, sehingga kalau tes paritas GAGAL dan cleanup JUGA gagal,
// error cleanup MENIMPA kegagalan paritas yang sebenarnya -- CI melaporkan
// "gagal menghapus baris" padahal masalah aslinya adalah data tidak cocok, dan
// jejak debug yang benar hilang sama sekali. Sekarang kegagalan paritas selalu
// menang; error cleanup hanya dilempar kalau tidak ada kegagalan lain.
let primaryError;
try {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;

  for (const row of dataset) {
    const created = await service.create(row);
    if (!created?.id) throw new Error("Seeded transaction did not return an id.");
    createdIds.push(created.id);
  }

  const nativeRows = await service.list();
  const actual = nativeRows.filter((row) => typeof row.keterangan === "string" && row.keterangan.startsWith(marker));
  if (actual.length !== dataset.length) {
    throw new Error(`Live pagination parity mismatch: expected ${dataset.length} seeded rows, observed ${actual.length}.`);
  }

  const expectedByKey = new Map(dataset.map((row) => [row.keterangan, row]));
  for (const row of actual) {
    const expected = expectedByKey.get(row.keterangan);
    if (!expected) throw new Error(`Unexpected parity row observed: ${row.keterangan}`);
    for (const field of ["jenis", "tanggal", "jumlah", "akun", "kategori", "mata_uang", "kurs", "jumlah_idr"]) {
      if (String(row[field] ?? null) !== String(expected[field] ?? null)) {
        throw new Error(`Live parity mismatch for ${row.keterangan}: ${field}`);
      }
    }
  }

  const usdRows = actual.filter((row) => row.mata_uang === "USD");
  const idrRows = actual.filter((row) => row.mata_uang === "IDR");
  if (!usdRows.length || !idrRows.length) throw new Error("Multi-currency parity dataset was not observed in both USD and IDR.");
  if (usdRows.some((row) => Number(row.kurs) !== 16000 || Number(row.jumlah_idr) !== Number(row.jumlah) * 16000)) {
    throw new Error("USD conversion parity failed.");
  }
  if (idrRows.some((row) => Number(row.kurs) !== 1 || Number(row.jumlah_idr) !== Number(row.jumlah))) {
    throw new Error("IDR conversion parity failed.");
  }

  const expectedOrder = [...actual].sort((a, b) => {
    const date = String(b.tanggal).localeCompare(String(a.tanggal));
    return date || String(a.id).localeCompare(String(b.id));
  });
  if (actual.some((row, index) => row.id !== expectedOrder[index]?.id)) {
    throw new Error("Transaction ordering parity failed.");
  }

  console.log(`Live data-rich parity: PASS (${actual.length} rows; pagination boundary + IDR/USD conversion + ordering verified)`);
} catch (error) {
  primaryError = error;
}

// Cleanup SELALU dijalankan (badan try di atas sudah menangkap semua error),
// jadi blok `finally` tidak diperlukan lagi -- dan karena tidak ada `throw`
// di dalam finally, tidak ada risiko error tertelan diam-diam.
let cleanupError;
try { await cleanup(); } catch (error) { cleanupError = error; }
try { await assertCleanup(); } catch (error) { cleanupError ??= error; }
try { await client.auth.signOut(); } catch (error) { cleanupError ??= error; }

// Urutan prioritas disengaja: kegagalan paritas yang asli DULU; error cleanup
// hanya dilaporkan kalau tesnya sendiri sebenarnya lolos.
const failure = primaryError ?? cleanupError;
if (failure) throw failure;
