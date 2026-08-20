import { createSupabaseBrowserClient } from "../services/supabase/client.js";

let client;

export function initAuthClient(config) {
  if (!client) client = createSupabaseBrowserClient(config);
  return client;
}

export function getAuthClient() {
  if (!client) throw new Error("Auth client belum diinisialisasi.");
  return client;
}
