-- ============================================================================
-- MIGRASI: Rate limiting server-side (Phase 6 -- AI/security)
-- ============================================================================
-- STATUS: SUDAH DITERAPKAN ke database live (project "My Finance",
-- uxfngmxghupdlwoeoxgh) tanggal 25 Agustus 2026 lewat akses Supabase MCP langsung -- BEDA dari
-- migrasi lain di repo ini. KOREKSI 2026-09-01: kalimat itu kini usang -- audit skema live
-- (docs/db-migration-status-2026-09-01.md) membuktikan SELURUH migrasi di sql/ sudah
-- diterapkan, tidak ada lagi yang "menunggu dijalankan manual". File ini disimpan sebagai
-- catatan/riwayat definisi lengkapnya, dan sebagai referensi kalau perlu setup project Supabase
-- BARU dari nol (mis. staging/development). Sudah diuji fungsional langsung ke live sebelum
-- dianggap selesai: akumulasi hitungan 3x panggilan berturut-turut, reset otomatis setelah
-- window kedaluwarsa (disimulasikan dgn mundurkan window_start), guard validasi p_max_calls<=0,
-- dan grant EXECUTE per role (anon berhasil dicabut, authenticated & service_role tetap bisa) --
-- semuanya diverifikasi query langsung ke information_schema/pg_catalog, bukan diasumsikan.
--
-- KENAPA FILE INI ADA: scan-receipt dan whatsapp-webhook (parsing bahasa natural)
-- sama-sama memanggil Gemini API -- setiap panggilan itu makan biaya & kuota. Sebelum migrasi
-- ini, TIDAK ADA pembatasan sama sekali di kedua function itu: guard yang ada di index.html
-- (aiInsightInFlight/aiChatInFlight/dsb) cuma mencegah DOUBLE-KLIK di 1 tab yang sama -- gampang
-- dilewati (banyak tab, panggil Edge Function langsung lewat fetch/curl pakai JWT sendiri, dst).
-- Migrasi ini memindahkan pembatasannya ke database: atomik, tidak bisa dilewati dari sisi
-- client sama sekali, konsisten dgn RPC atomik lain di repo ini (create_recurring_transaction,
-- replace_month_budgets, create_transfer_transaction).
--
-- CARA PAKAI (dari Edge Function, pakai service role ATAU anon key+JWT user):
--   const { data: allowed } = await supabase.rpc('check_and_consume_rate_limit', {
--     p_user_id: userId, p_action: 'scan-receipt', p_max_calls: 20, p_window_minutes: 60
--   });
--   if (!allowed) return jsonResponse({ error: 'Terlalu banyak percobaan, coba lagi nanti.' }, 429);
--
-- Sengaja SATU RPC generik (bukan 1 RPC per fitur) -- p_action bebas string apa saja, supaya
-- Edge Function lain (analyze-finance, get-exchange-rate, refresh-asset-price -- SETELAH source-
-- nya di-download & source-nya bisa diedit, lihat docs/AUDIT_REPORT_2026-08.md §4.7) bisa ikut pakai
-- infrastruktur yang sama tanpa migrasi SQL baru lagi per fitur.
--
-- Cara pakai: SQL Editor -> New query -> paste seluruh isi file ini -> Run. Aman dijalankan
-- ulang (create table/function ... or replace).
--
-- CATATAN NAMA TABEL: sengaja "api_rate_limits", BUKAN "rate_limits" -- pas dicek langsung ke
-- database live, ternyata SUDAH ADA tabel public.rate_limits (kolom: user_id, last_ai_chat_at)
-- yang sepertinya dipakai analyze-finance (salah satu Edge Function yang source-nya tidak ada
-- di repo ini, lihat docs/AUDIT_REPORT_2026-08.md §4.7) buat cooldown sederhana berbasis timestamp
-- terakhir. Skemanya beda total dari yang dibutuhkan migrasi ini (perlu kolom action/
-- window_start/call_count buat banyak jenis aksi sekaligus, bukan cuma 1 timestamp), dan tabel
-- itu tidak disentuh sama sekali di sini supaya tidak berisiko mematahkan analyze-finance yang
-- tidak bisa diverifikasi lagi perilakunya.

create table if not exists public.api_rate_limits (
    user_id      uuid not null,
    action       text not null,
    window_start timestamptz not null default now(),
    call_count   integer not null default 0,
    primary key (user_id, action)
);

comment on table public.api_rate_limits is
  'Penghitung rate-limit per (user_id, action), window tetap (fixed window, di-reset otomatis oleh check_and_consume_rate_limit() begitu window_start sudah lewat p_window_minutes). HANYA diakses lewat RPC di bawah atau service role -- lihat kebijakan RLS.';

alter table public.api_rate_limits enable row level security;
-- SENGAJA tidak ada satu pun policy untuk role authenticated/anon di sini -- api_rate_limits TIDAK
-- BOLEH dibaca/ditulis langsung dari browser sama sekali (kalau bisa, user bisa reset limitnya
-- sendiri dgn DELETE, atau intip limit user lain). Satu-satunya jalan masuk yang sah:
--   1. RPC check_and_consume_rate_limit() -- SECURITY DEFINER, jalan dgn hak akses pemilik
--      function (postgres), otomatis melewati RLS ini dari dalam.
--   2. Edge Function pakai SUPABASE_SERVICE_ROLE_KEY (mis. whatsapp-webhook) -- service role
--      juga otomatis melewati RLS.
-- Client (index.html) TIDAK PERNAH query tabel ini langsung dan tidak akan pernah butuh.

create or replace function public.check_and_consume_rate_limit(
    p_user_id uuid,
    p_action text,
    p_max_calls integer,
    p_window_minutes integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now          timestamptz := now();
    v_window_start timestamptz;
    v_call_count   integer;
begin
    -- FIX KEAMANAN (ditemukan & diperbaiki saat apply ke live, lihat riwayat percakapan/commit):
    -- Supabase otomatis meng-grant EXECUTE ke role anon utk SETIAP function baru di schema public
    -- (default privilege level-project) -- "revoke all from public" di bawah TIDAK mencabut ini,
    -- krn anon dapat grant-nya langsung, bukan lewat PUBLIC. Tanpa baris berikut, caller ANON
    -- (belum login sama sekali) bisa memanggil RPC ini -- dan karena auth.uid() JUGA null utk
    -- anon (sama seperti utk service_role terpercaya), guard "auth.uid() is not null and ..." di
    -- bawah TIDAK mendeteksinya: anon bisa kirim p_user_id SEMBARANG dan menghabiskan/mereset
    -- jatah rate limit USER LAIN (DoS). auth.role() membedakan ini dgn benar: null = konteks
    -- terpercaya (service_role/panggilan SQL langsung), 'anon' = publik tak terverifikasi.
    if auth.role() = 'anon' then
        raise exception 'Caller anonim tidak boleh memanggil check_and_consume_rate_limit.';
    end if;
    -- Kalau dipanggil dgn JWT user biasa (auth.uid() terisi), user itu HANYA boleh memeriksa
    -- rate limit MILIKNYA SENDIRI -- tidak boleh diam-diam mengisi/menghabiskan limit user lain
    -- dengan mengirim p_user_id sembarang. Kalau dipanggil lewat service role (mis. dari
    -- whatsapp-webhook, yang usernya diresolve dari nomor WhatsApp, bukan dari JWT), auth.uid()
    -- otomatis NULL -- pengecekan ini dilewati, dipercaya sepenuhnya krn cuma Edge Function
    -- pemegang SUPABASE_SERVICE_ROLE_KEY yang bisa manggil dgn konteks itu.
    if auth.uid() is not null and auth.uid() <> p_user_id then
        raise exception 'Tidak boleh memeriksa/mengisi rate limit milik user lain.';
    end if;
    if p_max_calls <= 0 or p_window_minutes <= 0 then
        raise exception 'p_max_calls dan p_window_minutes harus lebih dari 0.';
    end if;

    -- UPSERT atomik: baris belum ada -> mulai window baru hitungan 1. Baris sudah ada TAPI
    -- window_start-nya sudah kedaluwarsa (lebih lama dari p_window_minutes yang lalu) -> reset
    -- ke window baru hitungan 1. Baris ada & window masih berlaku -> call_count + 1. Semuanya 1
    -- statement, jadi tidak ada celah race condition antara SELECT dan UPDATE terpisah kalau ada
    -- 2 request nyaris bersamaan. Sudah diuji langsung (INSERT, akumulasi count, reset window
    -- kedaluwarsa) terhadap database live sebelum migrasi ini dianggap selesai.
    insert into public.api_rate_limits as rl (user_id, action, window_start, call_count)
    values (p_user_id, p_action, v_now, 1)
    on conflict (user_id, action) do update
        set call_count   = case when rl.window_start <= v_now - make_interval(mins => p_window_minutes)
                                 then 1 else rl.call_count + 1 end,
            window_start = case when rl.window_start <= v_now - make_interval(mins => p_window_minutes)
                                 then v_now else rl.window_start end
    returning window_start, call_count into v_window_start, v_call_count;

    return v_call_count <= p_max_calls;
end;
$$;

comment on function public.check_and_consume_rate_limit is
  'Cek DAN langsung catat 1 pemakaian dalam sekali panggilan (atomik) -- true = masih boleh lanjut, false = sudah kena limit utk window saat ini. Panggil ini SEBELUM melakukan operasi mahal (panggil Gemini, dsb), bukan sesudahnya.';

-- Hanya role authenticated (dan service_role, yang otomatis dapat semua privilege) yang boleh
-- memanggil RPC ini -- anon (belum login) tidak butuh & tidak boleh. Baris "revoke ... from
-- public" SENGAJA tidak cukup sendirian (lihat catatan di dalam function di atas) -- makanya ada
-- revoke eksplisit dari anon juga sebagai lapis proteksi grant, di atas cek auth.role() di kode.
revoke all on function public.check_and_consume_rate_limit from public;
revoke execute on function public.check_and_consume_rate_limit from anon;
grant execute on function public.check_and_consume_rate_limit to authenticated, service_role;
