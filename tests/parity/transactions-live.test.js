import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createTransactionService } from "../../src/services/transactions.js";
import { runTransactionReadParity } from "../../src/services/parity/transactions.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.log("Transaction live parity: SKIPPED (Supabase secrets not configured)");
  process.exit(0);
}

const email = process.env.PARITY_TEST_EMAIL;
const password = process.env.PARITY_TEST_PASSWORD;

if (!email || !password) {
  console.log("Transaction live parity: SKIPPED (dedicated parity test credentials not configured)");
  process.exit(0);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await supabase.auth.signInWithPassword({ email, password });

const native = createTransactionService(supabase);

// The legacy callback adapter is intentionally supplied by the caller/environment.
// This test never performs INSERT/UPDATE/DELETE.
const legacyRead = globalThis.__MYFINANCE_LEGACY_TRANSACTION_READ__;
if (typeof legacyRead !== "function") {
  console.log("Transaction live parity: SKIPPED (legacy read adapter not injected)");
  process.exit(0);
}

const result = await runTransactionReadParity({
  legacyRead,
  nativeRead: () => native.list(),
});

assert.equal(result.equal, true, JSON.stringify(result, null, 2));
console.log(`Transaction live parity: PASS (${result.nativeCount} rows)`);
