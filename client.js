/**
 * Browser-safe Supabase client adapter.
 * Configuration is read from build-time/public globals; no service-role secret belongs here.
 */
// PENTING: jsdelivr (bukan esm.sh) -- domain ini SUDAH ada di allowlist script-src pada
// _headers (CSP produksi). esm.sh belum pernah divalidasi jalan di browser sungguhan untuk
// app ini (cuma dites lewat Node/Playwright yang mengimpor paket npm langsung, bukan lewat
// file ini) -- kalau tetap esm.sh, baris ini akan DIBLOKIR diam-diam oleh CSP begitu dideploy
// ke Netlify, dan login akan gagal tanpa pesan yang jelas (module gagal di-fetch).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export function createSupabaseBrowserClient({ url, anonKey }) {
  if (!url || !anonKey) throw new Error("Supabase URL dan anon key wajib tersedia.");
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
