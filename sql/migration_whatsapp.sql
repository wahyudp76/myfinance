-- ============================================================
-- Migrasi: Integrasi Bot WhatsApp (Fonnte)
-- ============================================================
-- Jalankan ini SEKALI lewat Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Membuat 2 tabel baru -- tidak menyentuh tabel yang sudah ada sama sekali.

-- 1) Kode verifikasi sementara, dibuat lewat app saat user klik "Hubungkan WhatsApp".
--    Baris di sini otomatis "kadaluarsa" (dicek via expires_at, bukan dihapus otomatis
--    oleh Postgres -- Edge Function yang menolak kode yang sudah lewat expires_at).
create table if not exists whatsapp_link_codes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    code text not null unique,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '10 minutes')
);

-- 2) Pemetaan nomor WhatsApp <-> akun MyFinance, HANYA terisi setelah kode di atas
--    berhasil diverifikasi oleh Edge Function (bukan lewat insert langsung dari app).
create table if not exists whatsapp_links (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references auth.users(id) on delete cascade,
    whatsapp_number text not null unique,
    linked_at timestamptz not null default now()
);

alter table whatsapp_link_codes enable row level security;
alter table whatsapp_links enable row level security;

-- User cuma boleh bikin & lihat kode miliknya sendiri lewat app (Edge Function pakai
-- service role key yang otomatis melewati RLS, jadi tidak butuh policy tambahan utknya).
create policy "user bisa bikin kode sendiri" on whatsapp_link_codes
    for insert to authenticated with check (auth.uid() = user_id);
create policy "user bisa lihat kode sendiri" on whatsapp_link_codes
    for select to authenticated using (auth.uid() = user_id);

-- User cuma boleh LIHAT & HAPUS (unlink) baris miliknya sendiri. SENGAJA tidak ada
-- policy "insert" untuk role authenticated -- supaya tidak ada yang bisa klaim nomor
-- WhatsApp manapun langsung dari browser tanpa lewat verifikasi kode. Baris baru cuma
-- bisa dibuat oleh Edge Function (service role key, melewati RLS).
create policy "user bisa lihat link whatsapp sendiri" on whatsapp_links
    for select to authenticated using (auth.uid() = user_id);
create policy "user bisa putus link whatsapp sendiri" on whatsapp_links
    for delete to authenticated using (auth.uid() = user_id);
