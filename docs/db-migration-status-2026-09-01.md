# Status Migrasi Database — Verifikasi Live 2026-09-01

**Metode:** introspeksi langsung ke project Supabase `uxfngmxghupdlwoeoxgh` lewat
spec OpenAPI PostgREST (`GET /rest/v1/` dengan service-role key), dibandingkan
baris per baris dengan objek yang dijanjikan tiap file di `sql/`.
**Sifat:** READ-ONLY. Tidak ada satu pun DDL/DML yang dijalankan saat audit ini.

---

## 1. Ringkasan Eksekutif

> **Tidak ada migrasi yang tertunda.** Seluruh 7 file migrasi di `sql/` sudah
> tercermin di skema database live.

Ini penting dicatat karena beberapa file dan dokumen di repo masih memakai
bahasa *"menunggu dijalankan manual"* / *"perlu approval Anda"* (mis. header
`sql/migration_reliability_hardening_2026-08.sql`, tabel ringkasan
`docs/AUDIT_REPORT_2026-08.md` §1). Kalimat-kalimat itu kini **usang**: kondisi
nyata database sudah mendahului dokumentasinya. Siapa pun yang membaca repo ini
tanpa mengecek database live akan menyimpulkan hal yang salah — dan berisiko
menjalankan ulang migrasi karena mengira belum diterapkan.

## 2. Bukti per Migrasi

| File di `sql/` | Objek yang dijanjikan | Ada di live? |
|---|---|---|
| `2026-08-supabase-native-foundation.sql` | `transactions.mata_uang`, `.kurs`, `.jumlah_idr`, `.transfer_jumlah_tujuan`, `.transfer_mata_uang_tujuan` | ✅ kelimanya ada |
| `migration_transfer_currency_2026-08.sql` | `transactions.transfer_kurs_tujuan`, `.transfer_jumlah_tujuan_idr` + RPC `create_transfer_transaction` | ✅ kolom & RPC ada |
| `migration_reliability_hardening_2026-08.sql` | `transactions.recurring_id`, `.recurring_due_date` + RPC `create_recurring_transaction`, `replace_month_budgets` | ✅ kolom & kedua RPC ada |
| `migration_rate_limiting_2026-08.sql` | tabel `api_rate_limits` + RPC `check_and_consume_rate_limit` | ✅ ada (4 kolom sesuai definisi) |
| `migration_asset_price_columns_2026-08.sql` | `assets.simbol`, `.jumlah_unit`, `.sumber_harga` | ✅ ketiganya ada |
| `migration_assets_tanggal_nav_2026-09.sql` | `assets.tanggal_nav` | ✅ ada |
| `migration_whatsapp.sql` | tabel `whatsapp_link_codes`, `whatsapp_links` | ✅ keduanya ada |
| `event_trigger_ensure_rls.sql` | *(bukan migrasi — salinan referensi)* | ✅ `rls_auto_enable` terlihat di spec |
| `migration_f1_rls_auto_enable_2026-08-31.sql` | *(arsip proses — ditandai JANGAN DIJALANKAN)* | — |
| `migration_rls_hardening_2026-08-31.sql` | perubahan policy/grant | ⚠️ tidak terlihat lewat PostgREST (lihat §4) |

**Skema live yang terobservasi (10 objek):**
`api_rate_limits`, `assets` (13 kolom), `budgets`, `custom_icons`,
`rate_limits`, `recurring_transactions`, `settings`, `transactions` (18 kolom),
`whatsapp_link_codes`, `whatsapp_links`.

**RPC live (5):** `check_and_consume_rate_limit`, `create_recurring_transaction`,
`create_transfer_transaction`, `replace_month_budgets`, `rls_auto_enable`.

## 3. Temuan: tabel `refresh_price_rate_limits` TIDAK ADA — dan memang tidak perlu

`AGENT-HANDOFF.md` (bagian v43) menyebut rate limit Edge Function
`refresh-asset-price` disimpan di *"tabel `refresh_price_rate_limits`"*. Tabel
dengan nama itu **tidak ada** di database (`GET /rest/v1/refresh_price_rate_limits`
→ `404`).

Ini **bukan bug**, melainkan **catatan handoff yang keliru**. Kode sebenarnya
(`supabase/functions/refresh-asset-price/index.ts`) tidak pernah menyentuh tabel
bernama itu — ia memanggil RPC bersama:

```ts
const RATE_LIMIT_ACTION = "refresh-asset-price";   // baris 49
await supabase.rpc("check_and_consume_rate_limit", { p_action: RATE_LIMIT_ACTION, ... })
```

Jadi rate limit 30 req/jam itu tersimpan sebagai **baris** di `api_rate_limits`
dengan `action = 'refresh-asset-price'`, berbagi tabel dengan `analyze-finance`.
Desainnya benar; hanya dokumentasinya yang salah menyebut nama objek.

## 4. Batasan audit ini (jujur soal apa yang TIDAK bisa dibuktikan)

Audit ini memakai **service-role API key** (`sb_secret_…`), bukan token
Management API (`sbp_…`) dan bukan koneksi Postgres langsung. Konsekuensinya:

- **Bisa dibuktikan:** keberadaan tabel, kolom, dan RPC (semuanya muncul di spec
  OpenAPI PostgREST).
- **TIDAK bisa dibuktikan dari sini:** isi policy RLS, grant per-role, definisi
  constraint/index, dan body fungsi. `information_schema`/`pg_catalog` tidak
  ter-ekspos lewat PostgREST, dan tidak ada RPC `exec_sql` di project ini
  (sudah dicoba → `PGRST202`). Endpoint Management API
  `POST /v1/projects/{ref}/database/query` menolak key ini dengan `401`.

Karena itu status `migration_rls_hardening_2026-08-31.sql` di tabel §2 ditandai
⚠️ — bukan berarti gagal, tapi berarti **di luar jangkauan alat audit ini**.
Untuk memverifikasinya, jalankan skrip yang memang dirancang untuk itu:
`node scripts/rls-audit/rls-audit3-verify-hardening.mjs` (uji perilaku dengan
anon/authenticated key sungguhan, bukan introspeksi katalog).

## 5. Volume data produksi saat audit

| Tabel | Baris |
|---|---|
| `transactions` | 109 |
| `budgets` | 48 |
| `assets` | 4 |
| `recurring_transactions` | 0 |
| `whatsapp_links` | 0 |

## 6. Rekomendasi tindak lanjut

1. **Rotasi kredensial.** Service-role key yang dipakai untuk audit ini pernah
   dikirim lewat kanal chat → harus dianggap bocor. Rotasi di
   Dashboard → Settings → API Keys. Key ini melewati SEMUA policy RLS.
2. Perbarui header "menunggu dijalankan" di file `sql/` yang sudah diterapkan,
   agar tidak ada yang menjalankannya ulang karena salah baca.
3. Perbaiki penyebutan `refresh_price_rate_limits` di `AGENT-HANDOFF.md`
   → `api_rate_limits` dengan `action='refresh-asset-price'`. *(sudah dilakukan)*
