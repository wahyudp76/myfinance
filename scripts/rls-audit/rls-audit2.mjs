// RLS+GRANTS AUDIT -- ronde 2: verifikasi live utk temuan ronde 1.
// Fokus: (1) execute-grant RPC utk anon (correct-arity), (2) guard SECURITY
// DEFINER check_and_consume_rate_limit, (3) RLS tabel rate_limits &
// whatsapp_links (kosong di ronde 1 -> insersi anon = pembeda), (4) policy
// insert whatsapp_link_codes dgn user_id eksplisit (bentuk asli app).
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
  let json = null; try { json = JSON.parse(text); } catch { /* respons non-JSON (mis. HTML error page) -- biarkan json = null */ }
  return { status: res.status, pgCode: res.headers.get("x-postgrest-error-code") || json?.code || null, msg: (json?.message || text).slice(0, 110), returned: json };
}
const out = {};

// victim id (nilai uji saja)
const victim = (await rest("transactions?select=user_id&limit=1", { key: SERVICE })).returned?.[0]?.user_id;
out.victim = victim?.slice(0, 8) + "…";

// ---------- 1. anon correct-arity RPC ----------
out.anonRpc = {};
out.anonRpc.check_and_consume_rate_limit = await rest("rpc/check_and_consume_rate_limit", { method: "POST", body: { p_user_id: victim, p_action: "rls-audit-test", p_max_calls: 1, p_window_minutes: 1 } });
out.anonRpc.create_recurring_transaction = await rest("rpc/create_recurring_transaction", { method: "POST", body: { p_recurring_id: "00000000-0000-0000-0000-000000000000", p_due_date: "2026-09-01", p_jenis: "Pengeluaran", p_jumlah: 1, p_akun: "rls-audit", p_kategori: "rls-audit" } });
out.anonRpc.create_transfer_transaction = await rest("rpc/create_transfer_transaction", { method: "POST", body: { p_tanggal: "2026-08-31", p_jumlah: 1, p_akun_sumber: "a", p_akun_tujuan: "b", p_mata_uang_sumber: "IDR", p_mata_uang_tujuan: "IDR", p_kurs_sumber: 1, p_kurs_tujuan: 1 } });
out.anonRpc.replace_month_budgets = await rest("rpc/replace_month_budgets", { method: "POST", body: { p_bulan: "2099-12", p_budgets: "[]" } });

// ---------- 2. anon insert utk tabel yg RLS-nya belum terbukti ----------
out.anonInsert = {};
const w = (r) => ({ status: r.status, pgCode: r.pgCode, msg: r.msg });
out.anonInsert.rate_limits = w(await rest("rate_limits", { method: "POST", body: { user_id: victim, last_ai_chat_at: new Date().toISOString() } }));
if (out.anonInsert.rate_limits.status === 201) await rest(`rate_limits?user_id=eq.${victim}`, { method: "DELETE", key: SERVICE });
out.anonInsert.whatsapp_links = w(await rest("whatsapp_links", { method: "POST", body: { user_id: victim, whatsapp_number: "+999000000" } }));
if (out.anonInsert.whatsapp_links.status === 201) await rest(`whatsapp_links?user_id=eq.${victim}`, { method: "DELETE", key: SERVICE });

// ---------- 3. user audit sementara (ronde 2) ----------
const EMAIL = `rls-audit-${Date.now().toString(36)}@audit.local`;
const PASS = `A${crypto.randomUUID().replace(/-/g, "")}!`;
const cu = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }) })).json();
const tk = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) })).json()).access_token;
out.auditUser = cu.id.slice(0, 8) + "…";

out.authRpc = {};
// guard definer: user A utk user B -> HARUS ditolak
out.authRpc.rateLimit_victimId = w(await rest("rpc/check_and_consume_rate_limit", { method: "POST", token: tk, body: { p_user_id: victim, p_action: "rls-audit-test", p_max_calls: 1, p_window_minutes: 1 } }));
// userId sendiri -> boleh (lalu dibersihkan)
out.authRpc.rateLimit_ownId = w(await rest("rpc/check_and_consume_rate_limit", { method: "POST", token: tk, body: { p_user_id: cu.id, p_action: "rls-audit-test", p_max_calls: 5, p_window_minutes: 1 } }));

out.authInsert = {};
out.authInsert.whatsapp_link_codes_explicitUid = w(await rest("whatsapp_link_codes", { method: "POST", token: tk, body: { user_id: cu.id, code: `rls-audit-${Date.now().toString(36)}` } }));
out.authInsert.whatsapp_links_own = w(await rest("whatsapp_links", { method: "POST", token: tk, body: { user_id: cu.id, whatsapp_number: "+999000001" } }));
out.authInsert.rate_limits_own = w(await rest("rate_limits", { method: "POST", token: tk, body: { user_id: cu.id, last_ai_chat_at: new Date().toISOString() } }));

// ---------- 4. bersih-bersih total ----------
await rest("api_rate_limits?action=eq.rls-audit-test", { method: "DELETE", key: SERVICE });
for (const t of ["rate_limits", "whatsapp_link_codes", "whatsapp_links", "transactions", "budgets", "assets", "settings", "custom_icons", "recurring_transactions"]) {
  await rest(`${t}?user_id=eq.${cu.id}`, { method: "DELETE", key: SERVICE });
}
const du = await fetch(`${URL_}/auth/v1/admin/users/${cu.id}`, { method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
out.cleanup = `user audit & semua baris uji dihapus (HTTP ${du.status})`;

console.log(JSON.stringify(out, null, 1));
