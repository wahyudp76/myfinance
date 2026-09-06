-- ============================================================================
-- STATUS LIVE: TERVERIFIKASI SUDAH DITERAPKAN (2026-09-03, via Management API).
-- Introspection pg_policies: ke-14 policy di file ini ADA di database live dan
-- SELURUHNYA sudah memakai bentuk initplan (( SELECT auth.uid() AS uid) = user_id)
-- -- bentuk deparse persis yang dihasilkan `(select auth.uid()) = user_id`
-- (dibuktikan eksperimen policy uji begin/rollback: auth.uid() polos ter-deparse
-- `(auth.uid() = x)`, terbungkus ter-deparse `(( SELECT auth.uid() AS uid) = x)`).
-- Index whatsapp_link_codes_user_id_idx juga SUDAH ada. TIDAK ADA yang perlu
-- dijalankan ulang dari file ini -- menjalankannya hanya churn DROP+CREATE
-- policy identik. Catatan riwayat: AGENT-HANDOFF.md entri v68 (langkah DB).
-- ============================================================================

-- MYFINANCE — RLS PERFORMANCE FIX (auth.uid() initplan)
-- Additive/non-destructive: hanya menulis ulang definisi POLICY yang sudah ada
-- (DROP + CREATE policy dengan nama & efek akses yang PERSIS SAMA), tidak
-- mengubah/menghapus baris data apa pun. Direkomendasikan langsung oleh
-- Supabase Performance Advisor (lint: auth_rls_initplan).
--
-- Kenapa: auth.uid() dipanggil ULANG untuk SETIAP BARIS saat dievaluasi apa
-- adanya di dalam policy. Membungkusnya dengan (select auth.uid()) membuat
-- Postgres planner menghitungnya SEKALI per query (bukan per baris), yang
-- jadi jauh lebih penting begitu jumlah baris per user bertambah banyak.

begin;

drop policy if exists "Users can view own transactions" on public.transactions;
create policy "Users can view own transactions" on public.transactions
    for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own transactions" on public.transactions;
create policy "Users can insert own transactions" on public.transactions
    for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own transactions" on public.transactions;
create policy "Users can update own transactions" on public.transactions
    for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own transactions" on public.transactions;
create policy "Users can delete own transactions" on public.transactions
    for delete using ((select auth.uid()) = user_id);

drop policy if exists "Users manage own budgets" on public.budgets;
create policy "Users manage own budgets" on public.budgets
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own assets" on public.assets;
create policy "Users manage own assets" on public.assets
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own settings" on public.settings;
create policy "Users manage own settings" on public.settings
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own custom icons" on public.custom_icons;
create policy "Users manage own custom icons" on public.custom_icons
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own recurring transactions" on public.recurring_transactions;
create policy "Users manage own recurring transactions" on public.recurring_transactions
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own rate limit row" on public.rate_limits;
create policy "Users manage own rate limit row" on public.rate_limits
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "user bisa bikin kode sendiri" on public.whatsapp_link_codes;
create policy "user bisa bikin kode sendiri" on public.whatsapp_link_codes
    for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "user bisa lihat kode sendiri" on public.whatsapp_link_codes;
create policy "user bisa lihat kode sendiri" on public.whatsapp_link_codes
    for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "user bisa lihat link whatsapp sendiri" on public.whatsapp_links;
create policy "user bisa lihat link whatsapp sendiri" on public.whatsapp_links
    for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "user bisa putus link whatsapp sendiri" on public.whatsapp_links;
create policy "user bisa putus link whatsapp sendiri" on public.whatsapp_links
    for delete to authenticated using ((select auth.uid()) = user_id);

-- Sekalian lengkapi index FK yang hilang (lint: unindexed_foreign_keys).
create index if not exists whatsapp_link_codes_user_id_idx on public.whatsapp_link_codes (user_id);

commit;
