/**
 * Resolusi user_id bersama untuk service-service Supabase.
 *
 * LATAR BELAKANG: dulu setiap service (transactions, assets, settings,
 * custom-icons, recurring) memanggil `auth.getUser()` di SETIAP operasi tulis.
 * `getUser()` selalu query ke server Auth (1 round-trip jaringan) hanya untuk
 * mendapatkan user id yang sebenarnya SUDAH ada di sesi lokal. Akibatnya setiap
 * simpan transaksi membayar 2 RTT berurutan: getUser() + insert.
 *
 * Perbaikan: coba `auth.getSession()` DULU (pembacaan storage lokal, TANPA
 * jaringan). Kalau sesi ada dan tokennya masih jauh dari kedaluwarsa,
 * user_id dipakai langsung -- menghemat 1 RTT per operasi tulis. Fallback ke
 * `getUser()` dipertahankan untuk: sesi hilang, token mendekati kedaluwarsa
 * (getUser() sekalian memicu refresh), client minimal/mock tanpa getSession(),
 * atau error tak terduga -- sehingga perilaku lama 100% terjaga di kasus itu.
 */

const FALLBACK_BUFFER_SECONDS = 30;

function requireClient(client) {
  if (!client) throw new Error("Supabase client belum diberikan.");
  return client;
}

/**
 * @returns {Promise<string>} id user yang sedang login.
 */
export async function getCurrentUserId(client) {
  const supabase = requireClient(client);
  const nowSec = Math.floor(Date.now() / 1000);

  // Jalur cepat: sesi lokal (tidak ada jaringan). Buffer 30 detik supaya token
  // yang TINGGAL KEDALUWARSA tidak dipakai -- fallback getUser() di bawah juga
  // yang akan memicunya refresh.
  try {
    const { data } = await supabase.auth.getSession();
    const session = data && data.session;
    if (
      session &&
      session.user &&
      session.user.id &&
      (session.expires_at == null || session.expires_at > nowSec + FALLBACK_BUFFER_SECONDS)
    ) {
      return session.user.id;
    }
  } catch {
    // getSession tidak tersedia (mock lama / client minimal) -> jalur fallback.
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sesi login tidak ditemukan. Silakan login ulang.");
  return data.user.id;
}
