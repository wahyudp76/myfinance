// supabase/functions/_shared/bibit.js
//
// Helper murni (tanpa Deno-specific API -- cuma Web Crypto + fetch-agnostic) utk
// mengambil & menormalkan data reksadana dari API publik Bibit
// (https://api.bibit.id/products/list). Dipakai Edge Function refresh-asset-price
// (sumber_harga "reksadana_bibit") dan DIUJI UNIT di tests/unit/bibit-market.test.js
// (file ini plain ESM JS supaya bisa di-import node:test maupun Deno).
//
// KENAPA di server (Edge Function), bukan browser? API Bibit mengirim header
// Access-Control-Allow-Origin: https://bibit.id -- terpatri ke origin mereka, jadi
// fetch lintas-origin dari browser aplikasi pasti diblok CORS. Edge Function tidak
// tunduk pada CORS, sehingga ini satu-satunya jalur otomatis yang jujur & stabil
// (tanpa proxy publik pihak-ketiga yang terbukti mati/tidak reliable saat riset 2026-09).
//
// FORMAT PAYLOAD (tidak berubah sejak 2021, diverifikasi live 2026-09-01):
// response = { message, data: "<hex>", meta } dengan <hex> = IV(32 hex) ||
// ciphertext-AES-256-CBC(hex) || KEY(32 char UTF-8 di akhir). Hasil dekripsi =
// JSON array produk; tiap item punya nav: { date, value } = NAB/UP terkini (IDR).

/**
 * Dekripsi payload hex API Bibit -> object/array JSON apa adanya.
 * Memakai Web Crypto (crypto.subtle) supaya jalan identik di Deno & Node.
 */
export async function decryptBibitPayload(hex) {
  const s = String(hex || "");
  if (s.length < 64 + 32 + 2) throw new Error("Payload Bibit terlalu pendek / tidak valid.");
  const ivHex = s.slice(0, 32);
  const keyStr = s.slice(-32);
  const ctHex = s.slice(32, -32);
  const iv = hexToBytes(ivHex);
  const ct = hexToBytes(ctHex);
  const keyBytes = new TextEncoder().encode(keyStr);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error("Web Crypto tidak tersedia di runtime ini.");
  const key = await subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const plain = await subtle.decrypt({ name: "AES-CBC", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

function hexToBytes(hex) {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Payload Bibit bukan hex genap.");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Normalkan nama dana utk pencocokan: lowercase, trim, rapatkan spasi. */
export function normalizeFundName(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Ambil field inti satu item produk Bibit. Mengembalikan null kalau item tidak
 * punya NAB numerik (jangan pernah dipakai utk menghitung nilai).
 */
export function parseBibitFund(item) {
  if (!item || typeof item !== "object") return null;
  const nav = item.nav && typeof item.nav === "object" ? item.nav : null;
  const navValue = nav && typeof nav.value === "number" && isFinite(nav.value) ? nav.value : null;
  if (navValue == null || navValue <= 0) return null;
  return {
    id: item.id != null ? String(item.id) : null,
    symbol: item.symbol != null ? String(item.symbol) : null,
    name: String(item.name || "").trim(),
    manager: item.investment_manager && typeof item.investment_manager === "object"
      ? String(item.investment_manager.name || "")
      : item.investment_manager != null ? String(item.investment_manager) : null,
    navValue,
    navDate: nav && nav.date ? String(nav.date) : null,
  };
}

/**
 * Pilih produk yg paling cocok utk query (nama dana ATAU id produk Bibit).
 * Urutan kecocokan: id numerik persis -> nama persis -> nama ternormalisasi persis.
 * Mengembalikan hasil parseBibitFund() atau null.
 */
export function pickBibitFundMatch(items, query) {
  const list = Array.isArray(items) ? items : [];
  const q = String(query || "").trim();
  if (!q) return null;
  const parsed = list.map(parseBibitFund).filter(Boolean);
  if (/^\d+$/.test(q)) {
    const byId = parsed.find((f) => f.id === q);
    if (byId) return byId;
  }
  const byExact = parsed.find((f) => f.name === q);
  if (byExact) return byExact;
  const nq = normalizeFundName(q);
  const byNorm = parsed.find((f) => normalizeFundName(f.name) === nq);
  if (byNorm) return byNorm;
  // Longgar tapi DETERMINISTIK: nama dana dimulai dgn query (prefix) ATAU memuat
  // SEMUA token query -- diambil hanya kalau tepat SATU kandidat, supaya tidak
  // pernah menebak diam-diam di antara beberapa dana mirip.
  const byPrefix = parsed.filter((f) => normalizeFundName(f.name).startsWith(nq));
  if (byPrefix.length === 1) return byPrefix[0];
  const tokens = nq.split(" ").filter((t) => t.length > 1);
  if (tokens.length >= 2) {
    const byTokens = parsed.filter((f) => {
      const nf = normalizeFundName(f.name);
      return tokens.every((t) => nf.includes(t));
    });
    if (byTokens.length === 1) return byTokens[0];
  }
  return null;
}

/**
 * Ambil array produk mentah dari body response API Bibit. Melempar error ramah
 * kalau payload kosong/gagal (mis. pencarian tak menemukan apa pun) -- jangan
 * pernah mengembalikan undefined ke pemanggil.
 */
export function extractBibitItems(responseBody) {
  const b = responseBody && typeof responseBody === "object" ? responseBody : {};
  if (typeof b.data !== "string" || b.data.length < 64 + 32 + 2) {
    throw new Error(
      "Dana tidak ditemukan di Bibit untuk pencarian ini. Periksa lagi nama reksadana persis seperti di aplikasi Bibit.",
    );
  }
  return b.data;
}

/**
 * Nama-nama dana yg mirip query (prefix/semua-token) -- utk pesan error ramah
 * supaya user bisa menyalin nama persis. Maks `max` nama, urut alfabet.
 */
export function listSimilarFundNames(items, query, max = 4) {
  const nq = normalizeFundName(query);
  const tokens = nq.split(" ").filter((t) => t.length > 1);
  const parsed = (Array.isArray(items) ? items : []).map(parseBibitFund).filter(Boolean);
  const sim = parsed.filter((f) => {
    const nf = normalizeFundName(f.name);
    return nf.startsWith(nq) || (tokens.length >= 2 && tokens.every((t) => nf.includes(t)));
  });
  return [...new Set(sim.map((f) => f.name))].sort().slice(0, max);
}

/** URL endpoint list produk Bibit dgn pencarian nama (parameter valid per API 2026). */
export function buildBibitListUrl(query, limit = 10) {
  const params = new URLSearchParams();
  params.set("page", "1");
  params.set("limit", String(limit));
  params.set("sort", "asc");
  params.set("sort_by", "7"); // urut nama
  if (query) params.set("name", String(query));
  return "https://api.bibit.id/products/list?" + params.toString();
}
