import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createTransactionService } from "../../src/services/transactions.js";
import { compareTransactionLists } from "../../src/services/parity/transactions.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

async function main() {
  const nativeClient = createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { error: authError } = await nativeClient.auth.signInWithPassword({
      email: required("PARITY_TEST_EMAIL"),
      password: required("PARITY_TEST_PASSWORD"),
    });
    if (authError) throw authError;

    const native = createTransactionService(nativeClient);
    const legacyPath = process.env.LEGACY_TRANSACTION_ROWS_FILE || "legacy-rows.json";
    const legacyRows = JSON.parse(await fs.readFile(legacyPath, "utf8"));
    const nativeRows = await native.list();
    const result = compareTransactionLists(legacyRows, nativeRows);

    if (!result.equal) {
      console.error("Transaction read parity: FAIL");
      console.error(JSON.stringify({
        legacyCount: result.legacyCount,
        nativeCount: result.nativeCount,
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    assert.equal(result.legacyCount, result.nativeCount);
    console.log(`Transaction read parity: PASS (${result.nativeCount} rows)`);
  } finally {
    await nativeClient.auth.signOut();
  }
}

await main();
