-- ============================================================================
-- MIGRASI: Rate limiting server-side (Phase 6 -- AI/security)
-- ============================================================================
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
-- nya di-download & source-nya bisa diedit, lihat AUDIT_REPORT_2026-08.md §4.7) bisa ikut pakai
-- infrastruktur yang sama tanpa migrasi SQL baru lagi per fitur.
--
-- Cara pakai: SQL Editor -> New query -> paste seluruh isi file ini -> Run. Aman dijalankan
-- ulang (create table/function ... or replace).

create table if not exists public.rate_limits (
    user_id      uuid not null,
    action       text not null,
    window_start timestamptz not null default now(),
    call_count   integer not null default 0,
    primary key (user_id, action)
);

comment on table public.rate_limits is
  'Penghitung rate-limit per (user_id, action), window tetap (fixed window, di-reset otomatis oleh check_and_consume_rate_limit() begitu window_start sudah lewat p_window_minutes). HANYA diakses lewat RPC di bawah atau service role -- lihat kebijakan RLS.';

alter table public.rate_limits enable row level security;
-- SENGAJA tidak ada satu pun policy untuk role authenticated/anon di sini -- rate_limits TIDAK
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
    -- 2 request nyaris bersamaan.
    insert into public.rate_limits as rl (user_id, action, window_start, call_count)
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
-- memanggil RPC ini -- anon (belum login) tidak butuh & tidak boleh.
revoke all on function public.check_and_consume_rate_limit from public;
grant execute on function public.check_and_consume_rate_limit to authenticated, service_role;
