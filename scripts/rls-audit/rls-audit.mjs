// RLS + GRANTS AUDIT -- behavioral probe utk seluruh tabel publik MyFinance.
// Membuat user audit sementara via Admin API (dihapus di akhir; FK on delete
// cascade membersihkan barisnya). Tidak mengubah data user sungguhan:
// - write test pakai baris milik user audit sendiri (dibersihkan), dan
// - foreign-user_id insert DIBERHKENTI oleh RLS (42501); bila ternyata lolos,
//   baris junk langsung dihapus via service key dan dicatat sbg TEMUAN.
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

async function rest(path, { method = "GET", key = ANON, token, body, prefer } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${token || key}` };
  if (body) headers["Content-Type"] = "application/json";
  if (prefer) headers["Prefer"] = prefer;
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const range = res.headers.get("content-range"); // "0-4/923"
  let json = null; const text = await res.text();
  try { json = JSON.parse(text); } catch { /* empty body */ }
  const pgCode = res.headers.get("x-postgrest-error-code") || (json && json.code) || null;
  const pgMsg = (json && json.message) || text.slice(0, 120) || null;
  return {
    status: res.status,
    rows: Array.isArray(json) ? json.length : null,
    total: range && range.includes("/") ? Number(range.split("/")[1]) : null,
    returned: Array.isArray(json) ? json : null,
    pgCode, pgMsg,
  };
}

const mask = (id) => (id ? `${String(id).slice(0, 8)}…` : null);
const out = { probes: {}, tables: {}, rpcs: {}, notes: [] };

// ---------- 1. Eksposur per role (OpenAPI yang dilihat tiap key) ----------
async function spec(key) {
  const r = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const j = await r.json();
  const tables = Object.keys(j.definitions || {}).filter((t) => !t.startsWith("rpc_") && !(j.definitions[t].type === "object" && j.definitions[t].properties && j.definitions[t].description?.startsWith("@")));
  const rpcs = [...new Set(Object.keys(j.paths || {}).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5)))];
  return { tables, rpcs };
}
out.probes.specAnon = await spec(ANON);
out.probes.specService = await spec(SERVICE);

const ALL_TABLES = out.probes.specService.tables;

// ---------- 2. Anon read per tabel + baseline global (service) ----------
let victimId = null;
for (const t of ALL_TABLES) {
  const anon = await rest(`${t}?select=*&limit=3`);
  const svc = await rest(`${t}?select=*&limit=1`, { key: SERVICE, prefer: "count=exact" });
  const anonLeak = anon.status === 200 && anon.rows > 0;
  out.tables[t] = { anon: { status: anon.status, rows: anon.rows, pgCode: anon.pgCode }, serviceTotal: svc.total, anonLeak };
  if (!victimId && anon.returned?.[0]?.user_id) victimId = anon.returned[0].user_id;
}
if (!victimId) {
  for (const t of ALL_TABLES) {
    const r = await rest(`${t}?select=user_id&limit=1`, { key: SERVICE });
    if (r.returned?.[0]?.user_id) { victimId = r.returned[0].user_id; break; }
  }
}
out.notes.push(`victim user_id: ${mask(victimId)} (hanya dipakai sbg nilai uji, tidak dicetak mentah)`);

// ---------- 3. User audit sementara ----------
// pre-sweep: user audit terbengkalai dari run yg gagal di tengah (baris + user)
{
  const list = await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const users = (await list.json())?.users || [];
  for (const u of users) {
    if (String(u.email || "").startsWith("rls-audit-") && u.email.endsWith("@audit.local")) {
      for (const t of ALL_TABLES) await rest(`${t}?user_id=eq.${u.id}`, { method: "DELETE", key: SERVICE });
      await fetch(`${URL_}/auth/v1/admin/users/${u.id}`, {
        method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
      out.notes.push(`pre-sweep: user audit lama ${u.email} dihapus`);
    }
  }
}
const AUDIT_EMAIL = `rls-audit-${Date.now().toString(36)}@audit.local`;
const AUDIT_PASS = `A${crypto.randomUUID().replace(/-/g, "")}!`;
const createUser = await fetch(`${URL_}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: AUDIT_EMAIL, password: AUDIT_PASS, email_confirm: true }),
});
const created = await createUser.json();
if (!created.id) { console.error("GAGAL buat user audit:", createUser.status, created); process.exit(1); }
const auditUid = created.id;

const tokRes = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: AUDIT_EMAIL, password: AUDIT_PASS }),
});
const tok = (await tokRes.json()).access_token;
if (!tok) { console.error("GAGAL signin user audit"); process.exit(1); }
out.notes.push(`audit user: ${mask(auditUid)} (${AUDIT_EMAIL}) — dihapus di akhir`);

// ---------- 4. Matriks per tabel sbg user audit ----------
const PAYLOADS = {
  transactions: { jenis: "Pengeluaran", tanggal: "2026-08-31", jumlah: 1, akun: "rls-audit", kategori: "rls-audit", keterangan: "RLS-AUDIT-JUNK" },
  budgets: { bulan: "2099-12", kategori: "rls-audit", jumlah: 1 },
  assets: { nama: "rls-audit", kategori: "rls-audit", modal: 0, nilai: 0 },
  settings: { data: { audit: true } },
  custom_icons: { account_name: "rls-audit", icon_data: {} },
  recurring_transactions: { jenis: "Pengeluaran", jumlah: 1, akun: "rls-audit", kategori: "rls-audit", frequency: "bulanan", start_date: "2026-08-31", next_due_date: "2026-09-30" },
  api_rate_limits: { window_start: "2026-08-31T00:00:00Z" },
  whatsapp_link_codes: { code: "rls-audit-junk" },
  whatsapp_links: { phone: "rls-audit-junk" },
};

for (const t of ALL_TABLES) {
  const e = out.tables[t];
  e.auth = {};
  // (a) baca semua -- user baru: HARUS 0 baris (jika > 0 = kebocoran lintas user)
  const see = await rest(`${t}?select=user_id&limit=1000`, { token: tok });
  e.auth.seeAll = { status: see.status, rows: see.rows };
  // (b) insert milik sendiri (tanpa user_id -> default auth.uid())
  const ins = await rest(t, { method: "POST", token: tok, body: PAYLOADS[t] || {}, prefer: "return=representation" });
  e.auth.insertOwn = { status: ins.status, pgCode: ins.pgCode };
  const rowId = ins.returned?.[0]?.id || ins.returned?.[0]?.user_id || null;
  // (c) foreign user_id insert -> HARUS ditolak
  if (victimId) {
    const f = await rest(t, { method: "POST", token: tok, body: { ...PAYLOADS[t], user_id: victimId }, prefer: "return=representation" });
    e.auth.insertForeign = { status: f.status, pgCode: f.pgCode };
    if (f.status === 201) { // TEMUAN: lolos -- bersihkan junk via service
      const junk = f.returned || [];
      for (const j of junk) {
        const idv = j.id || j.user_id;
        await rest(`${t}?id=eq.${idv}&user_id=eq.${victimId}`, { method: "DELETE", key: SERVICE });
      }
      e.auth.insertForeign.cleaned = true;
    }
  }
  // (d) update + delete milik sendiri
  if (rowId) {
    const key = t === "settings" ? `user_id=eq.${rowId}` : `id=eq.${rowId}`;
    const up = await rest(`${t}?${key}`, { method: "PATCH", token: tok, body: {}, prefer: "return=representation" });
    e.auth.updateOwn = { status: up.status };
    const del = await rest(`${t}?${key}`, { method: "DELETE", token: tok });
    e.auth.deleteOwn = { status: del.status };
  }
}

// ---------- 5. RPC probes ----------
const RPC_NAMES = out.probes.specService.rpcs;
for (const fn of RPC_NAMES) {
  const e = out.rpcs[fn] = {};
  e.asAnon = await rest(`rpc/${fn}`, { method: "POST", body: {} });
  e.asAnon = { status: e.asAnon.status, pgCode: e.asAnon.pgCode, pgMsg: (e.asAnon.pgMsg || "").slice(0, 80) };
}
// RPC isi nyata (utk cek invoker/definer & scope) -- arg minimal, Harapannya: sukses HANYA utk scope sendiri
const rrpc = {};
if (RPC_NAMES.includes("replace_month_budgets")) {
  rrpc.replace_month_budgets = await rest("rpc/replace_month_budgets", { method: "POST", token: tok, body: { bulan: "2099-12", budgets: "[]" } });
}
out.rpcs.authenticated = rrpc;

// ---------- 6. Bersih-bersih ----------
// hapus sisa baris audit user (kalau deleteOwn gagal), lalu hapus user auditnya
for (const t of ALL_TABLES) {
  await rest(`${t}?user_id=eq.${auditUid}`, { method: "DELETE", key: SERVICE });
}
const delUser = await fetch(`${URL_}/auth/v1/admin/users/${auditUid}`, {
  method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
});
out.notes.push(`cleanup: baris audit user tersapu + user dihapus (HTTP ${delUser.status})`);

console.log(JSON.stringify(out, null, 1));
