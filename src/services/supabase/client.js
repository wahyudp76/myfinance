/**
 * Browser-safe Supabase client adapter.
 * Configuration is read from build-time/public globals; no service-role secret belongs here.
 * v59 (2026-09-02): supabase-js kini VENDORED + PINNED (vendor/, 2.113.0) --
 * sebelumnya import floating "https://esm.sh/@supabase/supabase-js@2" yang
 * me-resolve ke rantai 7 request lintas-origin (stub -> sub-modul es2022).
 * Lihat vendor/README.md utk provenance & prosedur upgrade.
 */
import { createClient } from "../../../vendor/supabase-js-2.113.0.bundle.min.mjs";

export function createSupabaseBrowserClient({ url, anonKey }) {
  if (!url || !anonKey) throw new Error("Supabase URL dan anon key wajib tersedia.");
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
