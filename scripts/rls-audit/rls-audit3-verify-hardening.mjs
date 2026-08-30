// VERIFIKASI PASCA-HARDENING utk sql/migration_rls_hardening_2026-08-31.sql.
// Membuktikan 3 hal terhadap live DB (lihat docs/rls-grants-audit-2026-08-31.md §5):
//   F1: rls_auto_enable hilang dari spec service role
//   F3: 3 RPC invoker utk anon = "permission denied for function" (bukan RLS di dalam)
//       & jalur authenticated TETAP jalan (replace_month_budgets utk bulan uji)
//   F2: insert whatsapp_link_codes TANPA user_id kini 201 (default auth.uid() hidup)
// User audit sementara dibuat & dihapus; baris uji miliknya ikut tersapu.
// Kredensial dari environment (JANGAN hard-commit key apa pun):
const env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
};
if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_KEY) {
  console.error("Butuh SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY di environment.");
  process.exit(1);
}
const URL_ = env.SUPABASE_URL.replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_KEY;

async function rest(path, { method = "GET", key = ANON, token, body } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${token || key}` };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, code: res.headers.get("x-postgrest-error-code") || json?.code || null, msg: (json?.message || text).slice(0, 90) };
}
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -- ${detail}`); };

// ---------- F1: rls_auto_enable hilang ----------
const spec = await (await fetch(`${URL_}/rest/v1/`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })).json();
const rpcs = Object.keys(spec.paths || {}).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5));
check("F1 rls_auto_enable hilang dari spec", !rpcs.includes("rls_auto_enable"), `rpc tersisa: ${rpcs.sort().join(", ")}`);

// ---------- F3: anon permission denied (bukan RLS di dalam) ----------
const anonCalls = {
  create_recurring_transaction: { p_recurring_id: "00000000-0000-0000-0000-000000000000", p_due_date: "2026-09-01", p_jenis: "Pengeluaran", p_jumlah: 1, p_akun: "x", p_kategori: "x" },
  create_transfer_transaction: { p_tanggal: "2026-08-31", p_jumlah: 1, p_akun_sumber: "a", p_akun_tujuan: "b", p_mata_uang_sumber: "IDR", p_mata_uang_tujuan: "IDR", p_kurs_sumber: 1, p_kurs_tujuan: 1 },
  replace_month_budgets: { p_bulan: "2099-12", p_budgets: {} },
};
for (const [fn, body] of Object.entries(anonCalls)) {
  const r = await rest(`rpc/${fn}`, { method: "POST", body });
  check(`F3 anon ${fn}`, r.status === 401 && /permission denied for function/.test(r.msg), `HTTP ${r.status} ${r.code}: ${r.msg}`);
}

// ---------- user audit sementara ----------
const EMAIL = `rls-audit-${Date.now().toString(36)}@audit.local`;
const PASS = `A${crypto.randomUUID().replace(/-/g, "")}!`;
const cu = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }) })).json();
const tk = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) })).json()).access_token;

// F3 lanjutan: jalur authenticated tetap jalan (bulan uji 2099-12, object kosong)
const rb = await rest("rpc/replace_month_budgets", { method: "POST", token: tk, body: { p_bulan: "2099-12", p_budgets: {} } });
check("F3 authenticated replace_month_budgets tetap jalan", rb.status === 200 || rb.status === 204, `HTTP ${rb.status} ${rb.msg}`);

// ---------- F2: insert tanpa user_id -> default auth.uid() ----------
const ic = await rest("whatsapp_link_codes", { method: "POST", token: tk, body: { code: `rls-audit-${Date.now().toString(36)}` } });
check("F2 whatsapp_link_codes insert TANPA user_id = 201", ic.status === 201, `HTTP ${ic.status} ${ic.code || ""} ${ic.msg}`);

// ---------- bersih-bersih ----------
for (const t of ["whatsapp_link_codes", "whatsapp_links", "rate_limits", "api_rate_limits", "budgets", "transactions", "assets", "settings", "custom_icons", "recurring_transactions"]) {
  await rest(`${t}?user_id=eq.${cu.id}`, { method: "DELETE", key: SERVICE });
}
await rest(`budgets?bulan=eq.2099-12`, { method: "DELETE", key: SERVICE });
const du = await fetch(`${URL_}/auth/v1/admin/users/${cu.id}`, { method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
console.log(`\ncleanup: user audit dihapus (HTTP ${du.status}). ${results.filter((r) => r.ok).length}/${results.length} PASS`);
if (results.some((r) => !r.ok)) process.exit(1);
