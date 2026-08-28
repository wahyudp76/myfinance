/**
 * Browser-safe Supabase client adapter.
 * Configuration is read from build-time/public globals; no service-role secret belongs here.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createSupabaseBrowserClient({ url, anonKey }) {
  if (!url || !anonKey) throw new Error("Supabase URL dan anon key wajib tersedia.");
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
