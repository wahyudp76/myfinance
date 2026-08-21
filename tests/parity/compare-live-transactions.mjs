import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createTransactionService } from "../../src/services/transactions.js";
import { compareTransactionLists } from "../../src/services/parity/transactions.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const nativeClient = createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error: authError } = await nativeClient.auth.signInWithPassword({
  email: required("PARITY_TEST_EMAIL"),
  password: required("PARITY_TEST_PASSWORD"),
});
if (authError) throw authError;

const native = createTransactionService(nativeClient);
const legacyJson = process.env.LEGACY_TRANSACTION_ROWS_JSON;
if (!legacyJson) {
  throw new Error("LEGACY_TRANSACTION_ROWS_JSON is required for final comparison");
}

const legacyRows = JSON.parse(legacyJson);
const nativeRows = await native.list();
const result = compareTransactionLists(legacyRows, nativeRows);

if (!result.equal) {
  console.error("Transaction read parity: FAIL");
  console.error(JSON.stringify({
    legacyCount: result.legacyCount,
    nativeCount: result.nativeCount,
    legacy: result.legacy,
    native: result.native,
  }, null, 2));
  process.exit(1);
}

assert.equal(result.legacyCount, result.nativeCount);
console.log(`Transaction read parity: PASS (${result.nativeCount} rows)`);
