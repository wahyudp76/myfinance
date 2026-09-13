# Audit Drift Skema: Database LIVE vs Repo `myfinance`

**Tanggal:** 2026-09-13
**Project Supabase:** `uxfngmxghupdlwoeoxgh` (ap-southeast-1, PostgreSQL 17.6 aarch64)
**Repo HEAD saat audit:** `d34abf4`
**Sifat audit:** read-only terhadap produksi selama pengumpulan data. Tidak ada
objek yang diubah sampai audit selesai dan pemilik repo memutuskan tindak lanjutnya.

**STATUS TINDAK LANJUT (v124): seluruh paket remediasi SUDAH dijalankan** atas
keputusan pemilik repo — dua perubahan di produksi, sisanya di repo. Lihat §7 dan
§9. Audit ini juga menemukan satu cacat tambahan di `schema.sql` yang belum
terlihat saat pengumpulan data pertama: **F12, dua pasang CHECK constraint
duplikat**, dengan komentar di `schema.sql` yang mengklaim sesuatu yang salah
tentang produksi.

---

## 1. Ringkasan eksekutif

Audit ini menyusul temuan tak sengaja saat menerapkan perbaikan v123: body
`create_transfer_transaction` yang tayang di produksi **tidak cocok dengan berkas
SQL mana pun di repo**. Pertanyaan yang diajukan pemilik repo: *apakah objek lain
juga menyimpang?*

**Jawabannya: ya, tapi jauh lebih jinak dari yang dikhawatirkan.**

| Kategori | Hasil |
|---|---|
| Tabel | **11 = 11** ✅ identik (nama, RLS, jumlah kolom) |
| Kolom | **79 = 79** ✅ jumlah sama, **1 kolom beda TIPE** (lihat F1) |
| Function | **4 vs 6** ⚠️ 2 ekstra di live |
| Policy RLS | **15 vs 16** ⚠️ 1 ekstra di live (redundan) |
| Index | **30 vs 31** ⚠️ 1 ekstra di live (justru bermanfaat) |
| Constraint | **38 vs 37** ⚠️ **1 CHECK hilang di live** |
| Trigger | **0 vs 1** ⚠️ 1 ekstra di live |
| Sequence | **0 vs 1** ⚠️ konsekuensi F1 |
| Edge Function | **5 = 5** ✅ semua ACTIVE, `verify_jwt=true` |
| Storage bucket | **0 = 0** ✅ |
| Body RPC | ✅ **4 dari 4 identik secara kode** (1 beda komentar saja) |
| Kebijakan RLS | ✅ **15 policy bersama identik persis**, termasuk `using`/`with check` |
| RLS aktif | ✅ **11 dari 11 tabel** |
| Guard anti-drift repo | ❌ **lolos palsu** untuk kolom/tipe — terbukti lewat mutation test (F11) |

**Tidak ditemukan satu pun celah keamanan.** Semua selisih bersifat *repo kurang
lengkap menggambarkan produksi*, bukan *produksi kurang aman dibanding repo*.
Satu-satunya hal yang membuat produksi lebih lemah dari repo adalah **F2** (satu
CHECK constraint hilang, 0 baris melanggar, perbaikan satu baris).

**Keadaan SETELAH remediasi v124** (dibuktikan dengan membangun ulang database
referensi dari `schema.sql` yang baru, lalu membandingkan ulang dengan produksi):

| Kategori | Sebelum | Sesudah |
|---|---|---|
| Tabel | 11 = 11 | **IDENTIK** |
| Kolom | 79 = 79, 1 beda tipe | **IDENTIK** |
| Constraint | 38 vs 37, 1 hilang di live | **IDENTIK (38 = 38)** |
| Index | 30 vs 31 | **IDENTIK (31 = 31)** |
| Policy | 15 vs 16 | **IDENTIK (15 = 15)** |
| Trigger | 0 vs 1 | **IDENTIK (1 = 1)** |
| Sequence | 0 vs 1 | **IDENTIK (1 = 1)** |
| Function | 4 vs 6 | 5 vs 6 — sisa 1 (`rls_auto_enable`) **memang diizinkan**, terdokumentasi |

Sisa perbedaan body function hanya dua dan keduanya **dinormalkan, bukan
diabaikan**: komentar (F8) dan akhir baris CRLF vs LF.

**Dua akar masalah, dan yang kedua lebih penting:**

1. **Akar dari F1, F4–F6, F9, F10** — tabel `platform_logos` di produksi dibuat
   **lebih dulu** dari migration-nya, kemungkinan lewat Supabase Dashboard UI.
   Karena setiap statement di repo memakai `if not exists`, migration yang
   kemudian dijalankan **diam-diam jadi no-op** dan tidak pernah membentuk ulang
   tabel itu. Satu penyebab, tujuh gejala.

2. **Akar dari kenapa semua itu bertahan lama tanpa ketahuan (F11)** — guard
   anti-drift milik repo membandingkan **nama**, bukan **definisi**. Terbukti
   lewat mutation test: menghapus sebuah kolom `not null` dari `schema.sql`
   membuat **seluruh 956 test tetap hijau**. Jadi bukan kebetulan drift ini baru
   ditemukan sekarang — memang tidak ada penjaga yang bisa menemukannya.

---

## 2. Metode (supaya bisa diulang, bukan dipercaya begitu saja)

Membandingkan teks SQL dengan regex itu rapuh — saya sudah terbukti tersesat
sekali di tengah audit ini (lihat §5). Jadi metodenya:

1. **Bangun database REFERENSI** dari `sql/schema.sql` di PostgreSQL 17.5 lokal
   (biner tertanam, tanpa root), memakai `scripts/schema-verify/supabase-shim.sql`
   milik repo sendiri. `schema.sql` dijalankan **dua kali** untuk memastikan
   idempoten — keduanya bersih.
2. **Dump katalog kedua sisi dengan query yang IDENTIK** (`tools/catalog.py`):
   11 kategori, bersumber dari `pg_class` / `pg_attribute` / `pg_proc` /
   `pg_policies` / `pg_indexes` / `pg_constraint` / `information_schema`.
3. **Bandingkan per definisi, bukan per nama** — inilah kuncinya. Nama constraint
   berbeda antara live dan repo walau definisinya sama.
4. **Untuk body function**, bandingkan `md5(prosrc)`; kalau beda, buang semua
   komentar lalu bandingkan ulang sha256-nya.
5. Semua hasil mentah disimpan sebagai JSON: `audit-ref/` (harapan) dan
   `audit-live2/` (produksi).

Alat: `tools/catalog.py`, `tools/build-ref.py`, `tools/sbq.py` — tidak satu pun
menyimpan kredensial (token hanya lewat variabel lingkungan).

---

## 3. Temuan, diurutkan menurut beratnya

### F1 — `platform_logos.id`: `uuid` di repo, `bigint IDENTITY` di produksi
**Jenis:** struktural · **Dampak runtime:** NIHIL · **Dampak disaster-recovery:** sedang

| | Definisi |
|---|---|
| `sql/schema.sql:415` | `id uuid primary key default gen_random_uuid()` |
| `sql/migrations/20260906_platform_logos.sql:51` | `id uuid primary key default gen_random_uuid()` |
| **produksi** | `id bigint GENERATED AS IDENTITY` + sequence `platform_logos_id_seq`, nilai 1…31 |

Repo **konsisten internal** — kedua berkas berkata `uuid`. Yang menyimpang adalah
produksinya.

**Kenapa tidak merusak apa pun:** aplikasi tidak pernah menyentuh kolom `id`.
`src/services/supabase/platform-logos.js:11` hanya membaca:

```js
.select("platform_key, display_name, logo_url, source_url")
.eq("is_active", true)
.order("display_name", { ascending: true })
```

Identitas baris di seluruh alur adalah `platform_key` (index unik ada di kedua
sisi), bukan `id`.

**Akar masalah (bukti, bukan dugaan):** seluruh 12 baris live punya
`created_at = 2026-09-06` — tanggal yang sama dengan nama berkas migration
`20260906_platform_logos.sql`. `bigint generated as identity` adalah **default
yang dibuat otomatis oleh Supabase Dashboard** ketika membuat tabel lewat UI.
Urutannya hampir pasti: tabel dibuat lewat UI → migration dijalankan →
`create table if not exists` melihat tabel sudah ada → **no-op** →
`alter table add column if not exists id uuid …` melihat kolom `id` sudah ada →
**no-op juga**. Tidak ada error, tidak ada peringatan.

> **Jebakan yang layak dicatat sebagai pelajaran umum:** `if not exists` membuat
> migration *tahan dijalankan ulang*, tapi **tidak korektif**. Tabel yang sudah
> ada akan mempertahankan bentuk lamanya selamanya, dan migration akan
> melaporkan sukses.

**Konsekuensi nyata:** kalau suatu saat project harus dibangun ulang dari
`sql/schema.sql`, hasilnya **bukan** replika produksi. Itu bukan masalah hari
ini, tapi justru masalah di hari terburuk.

---

### F2 — CHECK `transfer_target_idr_nonnegative` **tidak ada di produksi**
**Jenis:** integritas data · **Dampak:** rendah · **Perbaikan:** murah, aman, reversibel

`sql/schema.sql:122-123` (juga `migration_transfer_currency_2026-08.sql:50-54`):

```sql
alter table public.transactions add constraint transfer_target_idr_nonnegative
  check (transfer_jumlah_tujuan_idr is null or transfer_jumlah_tujuan_idr >= 0);
```

Di produksi: **kolomnya ada, constraint-nya tidak.** Ini satu-satunya CHECK yang
benar-benar hilang — diverifikasi dengan membandingkan *himpunan definisi*, bukan
nama (lihat F3 untuk kenapa nama menipu).

**Kelayakan perbaikan sudah diuji:** dari 147 baris `transactions`, 6 punya nilai
`transfer_jumlah_tujuan_idr` terisi, dan **0 baris melanggar**. Jadi menambahkan
constraint tidak akan gagal.

**Dampak kalau dibiarkan:** nilai IDR tujuan negatif bisa tersimpan lewat tulis
langsung via PostgREST. Lewat RPC tidak mungkin (pembagiannya menghasilkan nilai
positif). Rendah, tapi ini satu-satunya selisih yang membuat produksi *lebih
lemah* dari repo.

---

### F3 — Empat CHECK di `transactions` ada di produksi tapi **bernama lain**
**Jenis:** kosmetik · **Dampak:** menyesatkan alat bantu

| Definisi (identik di kedua sisi) | Nama di repo | Nama di produksi |
|---|---|---|
| `jumlah_idr is null or jumlah_idr >= 0` | `transaction_amount_idr_nonnegative` | *berbeda* |
| `kurs is null or kurs > 0` | `transaction_currency_rate_positive` | *berbeda* |
| `transfer_jumlah_tujuan is null or > 0` | `transfer_target_amount_positive` | `transactions_transfer_jumlah_tujuan_positive` |
| `transfer_kurs_tujuan is null or > 0` | `transfer_target_rate_positive` | `transactions_transfer_kurs_tujuan_positive` |

**Ini nyaris membuat saya melaporkan alarm palsu.** Perbandingan berbasis nama
menyimpulkan "5 constraint hilang di produksi". Perbandingan berbasis definisi
menyimpulkan "1 hilang". Yang benar yang kedua.

**Pelajaran:** audit skema apa pun yang membandingkan `conname` akan
menghasilkan temuan palsu. Bandingkan `pg_get_constraintdef()`.

---

### F4 — Trigger + function `set_platform_logos_updated_at` **tidak ada di repo**
**Jenis:** repo kurang lengkap · **Dampak:** kecil

Produksi punya:

```sql
CREATE TRIGGER platform_logos_set_updated_at BEFORE UPDATE ON public.platform_logos
  FOR EACH ROW EXECUTE FUNCTION set_platform_logos_updated_at()
```

Frasa `set_platform_logos_updated_at` **tidak muncul di mana pun dalam folder
`sql/`** — tidak di `schema.sql`, tidak di satu pun dari 15 berkas migration.
Objek ini hanya ada di produksi.

**Dampak:** instalasi baru dari `schema.sql` punya kolom
`updated_at timestamptz not null default now()` yang **tidak pernah diperbarui
saat UPDATE**. Kolomnya jadi pembohong kecil. Tidak ada fitur yang bergantung
padanya hari ini.

---

### F5 — Index `platform_logos_active_idx` **tidak ada di repo**
**Jenis:** repo kalah performa · **Dampak:** kecil hari ini, benar secara desain

Produksi punya:

```sql
CREATE INDEX platform_logos_active_idx ON public.platform_logos
  USING btree (is_active, display_name)
```

Index ini **persis** melayani query aplikasi di F1 (`.eq('is_active', true)`
lalu `.order('display_name')`). Dengan 12 baris manfaatnya nol; tapi index-nya
benar dan `schema.sql` seharusnya memuatnya supaya instalasi baru tidak kalah
dari produksi.

---

### F6 — CHECK `platform_logos_key_format` **tidak ada di repo**
**Jenis:** repo kurang ketat · **Dampak:** kecil

Produksi memvalidasi `platform_key ~ '^[a-z0-9][a-z0-9_-]*$'`. Instalasi baru
tidak, sehingga kunci yang salah bentuk (spasi, huruf besar) bisa masuk dan
pencarian logo di sisi aplikasi akan gagal **tanpa error** — hanya logo yang tidak
muncul. Saat ini 0 dari 12 baris live melanggar format itu.

---

### F7 — Policy `platform_logos_read_authenticated` ekstra di produksi (redundan)
**Jenis:** sampah konfigurasi · **Dampak:** tidak ada, tapi niatnya kalah

Produksi punya **dua** policy SELECT di `platform_logos`:

| Policy | Kepada | `using` |
|---|---|---|
| `Platform logos are publicly readable` | `public` | `true` |
| `platform_logos_read_authenticated` | `authenticated` | `is_active = true` |

Policy Postgres yang *permissive* digabung dengan **OR**, jadi hasilnya
`true OR (is_active = true)` = `true`. Policy kedua **tidak membatasi apa pun**.

Kalau niatnya menyembunyikan logo nonaktif dari pengguna, niat itu **dikalahkan**
oleh policy pertama. Repo sendiri memilih baca publik secara sadar
(`schema.sql:430` — "Baca PUBLIK (katalog global, bukan data pribadi)"), dan
aplikasi sudah memfilter `.eq('is_active', true)`. Jadi **tidak ada kebocoran** —
yang ada hanya policy mati yang membingungkan pembaca berikutnya.

**Butuh keputusan:** hapus dari produksi, atau angkat ke repo. Jangan dibiarkan
menggantung tanpa penjelasan.

---

### F8 — `check_and_consume_rate_limit`: md5 beda, tapi **hanya komentar**
**Jenis:** jinak · **Dampak:** tidak ada · **Status:** alarm palsu yang berhasil dibatalkan

| | Panjang body | md5 |
|---|---|---|
| repo | 3173 byte | `61a9f2f0db23…` |
| live | 1494 byte | `bb892626040c…` |

Selisih 1679 byte itu seluruhnya komentar. Setelah semua komentar dibuang dan
whitespace dinormalkan:

```
panjang tanpa komentar : live=987  repo=987   (selisih 0)
sha256 tanpa komentar  : live=223bedda6c05a6a8  repo=223bedda6c05a6a8
KODE IDENTIK           : True
```

**Kedua guard keamanannya ADA di produksi:**

- `if auth.role() = 'anon' then` → penolakan pemanggil tak terverifikasi
- `if auth.uid() is not null and auth.uid() <> p_user_id then` → user tidak bisa
  menghabiskan jatah rate limit user lain

Repo sekadar punya komentar yang jauh lebih panjang (penjelasan "FIX KEAMANAN"
soal default privilege Supabase). **Tidak ada yang perlu diperbaiki.**

---

### F9 — `rls_auto_enable` + event trigger `ensure_rls` hanya di produksi
**Jenis:** SENGAJA & terdokumentasi · **Dampak:** instalasi baru kehilangan jaring pengaman

`schema.sql:54-57` menyatakan dengan eksplisit:

> `OPSIONAL (tidak dijalankan otomatis oleh file ini, butuh hak superuser /
> keputusan sadar): migrations/event_trigger_ensure_rls.sql dan
> migrations/migration_f1_rls_auto_enable_2026-08-31.sql -- jaring pengaman
> yang memaksa RLS aktif otomatis di tabel baru.`

Produksi **memakai** jaring itu — terverifikasi:

```
evtname=ensure_rls  evtevent=ddl_command_end  evtenabled=O
pemilik=postgres    fungsi=rls_auto_enable()
```

Jadi ini bukan drift tak sengaja, melainkan keputusan yang sudah tercatat. Yang
perlu disadari: **instalasi baru dari `schema.sql` tidak punya jaring ini**, jadi
tabel yang dibuat belakangan di sana akan ber-RLS **mati** secara default. Enam
event trigger lain milik `supabase_admin` (`pgrst_ddl_watch`, dll.) adalah
bawaan platform dan di luar kendali repo.

---

### F11 — Guard anti-drift milik repo **lolos palsu** untuk kolom & tipe
**Jenis:** celah penjaga · **Dampak:** tinggi jangka panjang · **Status:** terbukti lewat mutation test

Ini temuan yang paling berpengaruh ke depan, karena menjelaskan *kenapa* F1–F6
bisa bertahan lama tanpa ketahuan.

`tests/unit/sql-schema-completeness.test.js` punya 5 guard. Yang relevan:

- **"semua tabel yang dibuat migrasi ikut ada"** → hanya membandingkan **nama** tabel.
- **"semua kolom yang ditambahkan migrasi ikut ada"** → mencari nama kolom dengan
  `new RegExp(`\\b${column}\\b`).test(schema)` — **di seluruh teks `schema.sql`,
  tidak dibatasi ke tabel pemiliknya**.
- **"body RPC identik dengan migrasi kanoniknya"** → ketat (byte-identik), tapi
  hanya untuk 4 RPC di `CANONICAL_FUNCTIONS`.

Jadi guard ini **buta terhadap tipe kolom, default, constraint, index, trigger,
dan policy** — persis dimensi tempat drift nyata ditemukan (F1, F4, F5, F6).

**Bukti (mutation test, sudah dipulihkan):** kolom `updated_at` dihapus dari
`create table public.platform_logos` di `schema.sql`, tabel lain tidak disentuh.
Kolom itu masih disebut 2× di berkas yang sama (milik tabel lain). Hasilnya:

```
ok 1 - schema.sql: semua RPC yang dipanggil kode punya definisi
ok 2 - schema.sql: body RPC identik dengan migrasi kanoniknya (anti-drift)
ok 3 - schema.sql: semua tabel yang dibuat migrasi ikut ada
ok 4 - schema.sql: semua kolom yang ditambahkan migrasi ikut ada
ok 5 - schema.sql: policy memakai bentuk initplan (select auth.uid())
# pass 5   # fail 0
```

Bahkan seluruh suite **956 test tetap hijau** (953 pass, 3 skip karena dependensi).
Sebuah instalasi baru yang kehilangan kolom `platform_logos.updated_at` — yang
akan membuat `insert` dari seed gagal karena kolom itu `not null` — **tidak
membuat CI merah sama sekali**.

Ini persis pola yang sama dengan celah guard yang ditutup di v123 (guard yang
hanya memeriksa satu atribut dari tujuh), dan persis alasan `schema.sql` bisa
menyatakan `id uuid` sementara produksi memakai `bigint` tanpa ada yang protes:
**tidak ada satu pun penjaga yang membandingkan definisi, hanya nama.**

---

### F12 — `schema.sql` memasang **dua pasang CHECK constraint duplikat**
**Jenis:** cacat di repo · **Dampak:** kecil (pemborosan) + menyesatkan · **Ditemukan oleh:** uji asam, bukan oleh dump pertama

Temuan ini baru muncul setelah `schema.sql` diperbaiki (Paket 2) dan database
referensi dibangun ulang: jumlah constraint referensi jadi **40** sementara
produksi **38**, padahal tidak ada satu pun entri yang "hanya di salah satu sisi".
Selisih itu ternyata **definisi duplikat yang runtuh saat dibandingkan**.

`sql/schema.sql` memasang tujuh CHECK di `transactions`, dan dua di antaranya
duplikat persis:

| Definisi | Nama pertama | Nama kedua (duplikat) |
|---|---|---|
| `jumlah_idr is null or jumlah_idr >= 0` | `transaction_amount_idr_nonnegative` | `transactions_jumlah_idr_nonnegative` |
| `kurs is null or kurs > 0` | `transaction_currency_rate_positive` | `transactions_kurs_positive` |

Yang membuat ini layak dicatat: `schema.sql` **sudah punya komentar** yang
mengakui duplikasi itu dan memberinya pembenaran —

> `-- Dua constraint berikut duplikat SEMANTIK dari transaction_amount_idr_nonnegative`
> `-- & transaction_currency_rate_positive di atas, tapi namanya berbeda dan KEDUANYA`
> `-- ada di database live (migration_reliability_hardening_2026-08 menambahkannya`
> `-- lagi dengan nama sendiri). Disertakan supaya instalasi baru identik dgn live.`

**Klaim "KEDUANYA ada di database live" itu SALAH.** Produksi hanya punya satu
dari tiap aturan, memakai keluarga nama `transactions_*`. Diperiksa langsung lewat
`pg_constraint`: empat nama berikut **tidak pernah ada di produksi** —
`transaction_currency_rate_positive`, `transaction_amount_idr_nonnegative`,
`transfer_target_amount_positive`, `transfer_target_rate_positive`.

**Dampaknya:** instalasi baru mendapat **11** constraint di `transactions`
sementara produksi punya **9**, termasuk dua pasang aturan identik yang
dievaluasi **dua kali** pada setiap `INSERT`/`UPDATE`. Tidak merusak kebenaran
data, tapi memboroskan dan — yang lebih penting — membuat perbandingan skema
selanjutnya membingungkan. Inilah yang membuat perbandingan berbasis nama di awal
audit ini melaporkan "5 constraint hilang" padahal yang hilang cuma 1 (F3).

**Komentar yang salah lebih berbahaya daripada tidak ada komentar:** ia menutup
pertanyaan. Pembaca berikutnya melihat "sudah dijelaskan, keduanya ada di live"
dan berhenti memeriksa.

### F10 — Selisih yang setara secara semantik (dicatat agar tidak diaudit ulang)

| Objek | repo | produksi | Penilaian |
|---|---|---|---|
| `platform_logos.created_at`/`updated_at` default | `now()` | `timezone('utc'::text, now())` | **setara** — keduanya `timestamptz`, nilai identik |
| keunikan `platform_key` | `create unique index platform_logos_platform_key_key` | `UNIQUE (platform_key)` bernama sama | **setara** — penegakan & nama sama, `on conflict (platform_key)` jalan di keduanya |

---

## 4. Yang **BUKAN** drift — artefak metode, jangan salah tafsir

Bagian ini sama pentingnya dengan temuan di atas, karena di sinilah alarm palsu
paling mudah muncul.

**`table_grants`: REF 13 baris vs LIVE 44 baris.** Terlihat mencurigakan, tapi
ini **keterbatasan shim yang sudah terdokumentasi** di
`scripts/schema-verify/README.md` bagian "Batasan":

> shim ini bukan Supabase sungguhan: … tidak ada grant otomatis ke
> `anon`/`authenticated` untuk tabel baru di schema `public`.

Di produksi, `anon` memang punya `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,
TRUNCATE,UPDATE` di hampir semua tabel `public` — itu **default privilege
level-project Supabase**, bukan sesuatu yang diberikan `schema.sql`.

**Apakah itu kebocoran? Tidak.** Yang menahan adalah RLS, dan RLS terverifikasi
aktif di **11 dari 11 tabel**:

| Tabel | RLS | Policy |
|---|---|---|
| `api_rate_limits` | ✅ | **0** → tak terbaca dari client (sesuai CEK 6) |
| `transactions` | ✅ | 4 (select/insert/update/delete, semua `(select auth.uid()) = user_id`) |
| `platform_logos` | ✅ | 2 (katalog publik, disengaja) |
| 8 tabel lain | ✅ | 1–2, semua terikat `auth.uid()` |

Untuk pemanggil `anon`, `auth.uid()` bernilai NULL → seluruh policy bernilai
false → **nol baris terlihat**, walau hak tabelnya luas.

> **Catatan pertahanan-berlapis (bukan temuan drift):** `schema.sql` tidak
> me-`revoke` hak DML `anon`. RLS sudah menutupnya, tapi mencabut hak itu akan
> menambah satu lapis lagi. Layak dipertimbangkan terpisah, bukan bagian dari
> perbaikan drift.

**Juga bukan drift:**
- `function_grants` untuk `set_platform_logos_updated_at` menunjukkan
  `anon=True`. Fungsi ber-`returns trigger` **tidak bisa dipanggil langsung**
  (`trigger functions can only be called as trigger`), jadi tidak berbahaya.
  Ini pun sekadar default privilege Supabase.
- Extension produksi (`pg_stat_statements`, `pgcrypto`, `supabase_vault`,
  `uuid-ossp`) → bawaan platform.
- Baris `ipot` di `platform_logos` (nonaktif, `logo_url` mengarah ke URL
  indopremier yang 404) → sisa eksperimen. Repo **sengaja** tidak men-seed IPOT
  (`schema.sql:466-468`), dan aplikasi memfilter `is_active = true`, jadi baris
  itu tidak pernah tampil. Konsisten, bukan drift.

---

## 5. Kesalahan yang saya buat selama audit (dicatat supaya tidak diulang)

1. **Menyimpulkan "5 CHECK constraint hilang di produksi"** dari perbandingan
   `conname`. Setelah dibandingkan per `pg_get_constraintdef()`, yang benar-benar
   hilang hanya **1**. Empat lainnya ada dengan nama berbeda.
2. **Menyangka `check_and_consume_rate_limit` menyimpang secara keamanan** karena
   md5 body-nya beda dan live lebih pendek 1679 byte. Setelah komentar dibuang,
   kodenya identik byte-per-byte. Hampir saja ini dilaporkan sebagai celah.
3. **Regex policy pertama menghasilkan 0 kecocokan** padahal CI jelas memasang 15
   — karena nama policy di `schema.sql` memakai tanda kutip dan berada di baris
   terpisah dari `on public.<tabel>`.
4. Empat query inventaris pertama **gagal karena SQL saya sendiri**
   (`pg_sequences.schemaname` itu `name` bukan `oid`; `prosecattr` seharusnya
   `prosecdef`; `p.parallel` seharusnya `p.proparallel`;
   `information_schema.domains` tidak punya `is_nullable`).
5. **`prosecattr` vs `prosecdef`** dan **`tgenabled = 'O'`** (yang berarti
   *aktif*, bukan "off") hampir terbaca terbalik.

---

## 6. Batasan audit ini — yang **belum** terverifikasi

Jujur soal jangkauan, supaya tidak menimbulkan rasa aman palsu:

| Belum diperiksa | Kenapa |
|---|---|
| **Paritas kode Edge Function** | Management API tidak menyediakan endpoint unduh bundle. Yang terverifikasi hanya *slug ada*, `status=ACTIVE`, `verify_jwt=true`. Isi kodenya bisa saja berbeda dari `supabase/functions/`. |
| Konfigurasi **Auth/GoTrue** (provider, redirect URL, masa berlaku JWT) | Di luar cakupan permintaan; perlu endpoint terpisah. |
| **Default privilege** level-project (`ALTER DEFAULT PRIVILEGES`) | Tidak ikut di-dump. |
| Isi **`vault.decrypted_secrets`** | Sengaja tidak disentuh. |
| Kolom/tabel di schema **non-`public`** | Audit dibatasi ke `public` + objek yang dikendalikan repo. |

**Satu petunjuk yang layak ditindaklanjuti terpisah:** daftar Edge Function live
**tidak memuat `smooth-processor`**, padahal `supabase/functions/analyze-finance/index.ts:19-22`
masih mencatatnya sebagai function live. Itu menguatkan catatan lama bahwa
komentar tersebut basi — function-nya memang sudah tidak ada.

---

## 7. Remediasi — SUDAH DIJALANKAN (v124, atas keputusan pemilik repo)

### ⚠️ Peringatan yang harus dibaca lebih dulu

**Menjalankan ulang `sql/schema.sql` ke produksi BUKAN no-op murni.** Walau
aman dari sisi struktur, isinya akan:

- `insert … on conflict do update` → **menyentuh `updated_at` ke-11 logo**
- `drop policy if exists` + `create policy` → ada **jendela singkat tanpa policy**
- `drop constraint if exists` + `add constraint` → memindai ulang tabel (147 baris, sepele)

Perbaikan sebaiknya berupa **statement tertarget**,
bukan menjalankan ulang seluruh berkas. **Karena itu Paket 1 dan Paket 3
dijalankan sebagai statement tersendiri, bukan dengan menjalankan ulang
`schema.sql`.**

---

### Paket 1 — produksi: tutup F2 ✅ **SUDAH DIJALANKAN**

```sql
alter table public.transactions
  drop constraint if exists transfer_target_idr_nonnegative;
alter table public.transactions
  add constraint transfer_target_idr_nonnegative
  check (transfer_jumlah_tujuan_idr is null or transfer_jumlah_tujuan_idr >= 0);
```

Prasyarat sudah diverifikasi: **0 dari 147 baris melanggar**. Rollback:
`alter table public.transactions drop constraint if exists transfer_target_idr_nonnegative;`

### Paket 2 — repo: buat `schema.sql` jujur tentang `platform_logos` ✅ **SUDAH DIJALANKAN** (F1, F4, F5, F6, F9, F10, dan F12)

**Arah yang direkomendasikan: repo mengikuti produksi**, bukan sebaliknya.
Mengubah `id` produksi dari `bigint identity` ke `uuid` berarti menulis ulang
tabel dan membuang sequence — **berisiko, dan manfaatnya nol** karena aplikasi
tidak pernah memakai `id`.

Isinya: deklarasi `id bigint generated by default as identity`, function +
trigger `set_platform_logos_updated_at`, index `platform_logos_active_idx`,
CHECK `platform_logos_key_format`, dan default `timezone('utc', now())`.
Sebaiknya diterapkan identik di `sql/schema.sql` **dan** berkas kanonik
`sql/migrations/20260906_platform_logos.sql` demi konsistensi — tapi ketahuilah
bahwa guard `sql-schema-completeness.test.js` **tidak akan memaksa** hal itu:
ia hanya membandingkan *nama* tabel dan kolom, bukan definisinya (lihat F11).
Sinkronisasi di sini adalah disiplin, bukan sesuatu yang dijaga CI.

> **Konsekuensi WAJIB yang mudah terlewat:** menambah satu function membuat
> jumlah objek berubah dari `11/4/15` menjadi `11/5/15` (atau `11/5/16` kalau
> policy F7 ikut diangkat). Tiga tempat harus diperbarui bersama:
> 1. `EXPECTED = "11/4/15"` di `scripts/schema-verify/run.mjs`
> 2. guard `dokumen: jumlah tabel & RPC cocok dengan sql/schema.sql` di
>    `tests/unit/docs-consistency.test.js`
> 3. klaim jumlah tabel/RPC di `STRUKTUR-REPO.md`

### Paket 3 — keputusan F7 ✅ **SUDAH DIJALANKAN: dihapus dari produksi**

Pilih satu, jangan biarkan menggantung:
- **(a)** hapus `platform_logos_read_authenticated` dari produksi (paling bersih —
  policy itu memang tidak berpengaruh), atau
- **(b)** angkat ke `schema.sql` apa adanya + komentar yang menjelaskan bahwa ia
  redundan terhadap policy publik.

### Paket 4 — guard permanen ✅ **SUDAH DIJALANKAN: ketiga lapisnya**

Ini yang paling berharga jangka panjang, dan **satu-satunya yang mencegah
pengulangan**. `sql-schema-completeness.test.js` hanya membandingkan berkas-berkas
*di dalam repo* satu sama lain — dan itu pun hanya pada tingkat **nama** (F11) —
sehingga drift live-vs-repo **tidak terlihat oleh CI mana pun**: kedua sisi hijau
sementara yang tayang berbeda.

Usulan tiga lapis, dari yang termurah:

1. **Perketat guard kolom yang sudah ada** *(menutup F11, tanpa infrastruktur
   baru)*: batasi pencarian ke blok `create table` milik tabel yang benar, dan
   bandingkan **tipe + nullability + default**, bukan sekadar kehadiran nama.
   Uji-balik wajib: mutasi "hapus `updated_at` dari `platform_logos`" harus
   membuat suite **merah** — saat ini terbukti hijau.
2. **`scripts/schema-verify/drift-check.mjs`** — porting alat audit ini ke repo:
   bangun database referensi dari `schema.sql`, dump katalog live lewat
   Management API, bandingkan **per definisi** (bukan per nama — lihat F3).
   Dijalankan manual (`workflow_dispatch`) atau lokal oleh pemilik, memakai
   secret, jadi kredensial tidak perlu menempel di setiap push.
3. **Snapshot katalog di CI** — simpan `expected-catalog.json` hasil instalasi
   bersih, bandingkan di job `Schema install check` yang sudah ada. Tanpa
   kredensial, menangkap regresi sisi repo (mis. ada yang diam-diam mengubah
   tipe kolom atau menghapus constraint dari `schema.sql`).

---

## 8. Lampiran — artefak audit

Sebagian artefak audit **ikut masuk repo** karena nilainya jangka panjang;
sisanya tetap di workspace sebagai bukti mentah:

| Berkas | Isi |
|---|---|
| `audit-ref/*.json` | Katalog database referensi (dibangun dari `sql/schema.sql`) — 11 kategori |
| `audit-live2/*.json` | Katalog produksi, query identik — 11 kategori |
| `audit-live/*.json` | Dump inventaris tahap awal (16 berkas, termasuk `q18_body_ratelimit.json`) |
| `audit-live/ratelimit-LIVE.sql`, `ratelimit-REPO.sql` | Body F8 untuk pemeriksaan baris-per-baris |
| `tools/catalog.py` | Dumper katalog dua-target (live & lokal), tanpa kredensial tersimpan |
| `tools/build-ref.py` | Pembangun database referensi + dumper kedua sisi |
| `tools/sbq.py` | Runner SQL Management API (token hanya dari env `SBP`) |
| `ROLLBACK-v123-database-live.sql` | Body RPC live sebelum v123 ditimpa (dari pekerjaan sebelumnya) |
| `TERAPKAN-v123-ke-database-live.sql` | Rekaman yang sudah diterapkan ke produksi |

**Yang ikut masuk repo (v124):**

| Berkas repo | Isi |
|---|---|
| `docs/audit-drift-live-vs-repo-2026-09-13.md` | laporan ini |
| `scripts/schema-verify/drift-check.mjs` | alat pembanding katalog (CI `--check`, manual `--live-check`) |
| `scripts/schema-verify/catalog-queries.json` | query inventaris, satu sumber untuk kedua sisi |
| `scripts/schema-verify/expected-catalog.json` | snapshot katalog yang diharapkan |
| `scripts/schema-verify/sql-parse.mjs` | parser SQL bersama (guard unit + alat drift) |
| `tests/unit/drift-check-contract.test.js` | 5 guard: query wajib read-only, snapshot tidak basi, izin terdokumentasi, tanpa kredensial |

---

## 9. Hasil verifikasi setelah remediasi dijalankan

### 9.1 Yang dieksekusi di produksi (2 statement tertarget)

```sql
-- Paket 1 (F2)
alter table public.transactions
  add constraint transfer_target_idr_nonnegative
  check (transfer_jumlah_tujuan_idr is null or transfer_jumlah_tujuan_idr >= 0);

-- Paket 3 (F7)
drop policy if exists "platform_logos_read_authenticated" on public.platform_logos;
```

Diverifikasi sesudahnya: constraint terpasang dengan definisi yang persis sama
dengan `schema.sql`; jumlah policy `platform_logos` turun 2 → 1; **total policy
produksi 16 → 15, sama dengan repo**; data utuh (147 baris `transactions`, 12
baris `platform_logos`). `sql/schema.sql` **tidak** dijalankan ulang ke produksi
(lihat peringatan di awal §7).

### 9.2 Uji asam — bangun ulang referensi dari `schema.sql` yang baru

PostgreSQL 17.5 lokal, database kosong, `supabase-shim.sql` lalu `schema.sql`
**dua kali** (idempoten, keduanya bersih), lalu dump katalog kedua sisi dengan
`catalog-queries.json` yang sama:

```
  tables            A= 11 B= 11   IDENTIK
  columns           A= 79 B= 79   IDENTIK
  functions         A=  5 B=  6   selisih: 0/0/0   (+1 diizinkan di B: rls_auto_enable)
  function_grants   A=  5 B=  6   selisih: 0/0/0   (+1 diizinkan di B: rls_auto_enable)
  policies          A= 15 B= 15   IDENTIK
  indexes           A= 31 B= 31   IDENTIK
  constraints       A= 38 B= 38   IDENTIK
  triggers          A=  1 B=  1   IDENTIK
  sequences_views   A=  1 B=  1   IDENTIK

HASIL: TIDAK ADA DRIFT tak terduga.
```

`node scripts/schema-verify/drift-check.mjs --live-check` (membandingkan snapshot
ter-commit dengan produksi sungguhan) keluar dengan **kode 0**.

Perhatikan bahwa dua function yang md5 mentahnya berbeda — `check_and_consume_rate_limit`
(F8, komentar) dan `set_platform_logos_updated_at` (CRLF vs LF) — **tidak**
dilaporkan sebagai selisih. Itu bukan karena diabaikan: body-nya dibuang
komentarnya, dinormalkan akhir baris dan spasinya, lalu di-hash. Yang dibandingkan
adalah kodenya.

### 9.3 Uji negatif — semua penjaga baru terbukti bisa merah

Disiplin repo (`scripts/schema-verify/README.md`): *"cek yang tidak pernah gagal
cuma stempel hijau palsu."* Setiap penyuntikan berikut membuat suite merah, lalu
berkas dipulihkan dan diverifikasi ulang:

| # | Penyimpangan yang disuntik | Penjaga yang merah |
|---|---|---|
| 1 | hapus kolom `updated_at` dari `platform_logos` di `schema.sql` (**yang dulu lolos palsu**, F11) | 3 test |
| 2 | kembalikan `platform_logos.id` ke `uuid` | kontrak tipe |
| 3 | hapus trigger `platform_logos_set_updated_at` | 2 test |
| 4 | hapus index `platform_logos_active_idx` | guard objek |
| 5 | hapus CHECK `platform_logos_key_format` | guard objek |
| 6 | kembalikan default `created_at` ke `now()` polos | kontrak tipe |
| 7 | selipkan `delete` ke `catalog-queries.json` | guard read-only |
| 8 | selipkan `update` ke `catalog-queries.json` | guard read-only |
| 9 | tempel token `sbp_` ke `drift-check.mjs` | guard kredensial |
| 10 | buang satu entri tabel dari `expected-catalog.json` | guard snapshot basi |
| 11 | `platform_logos.id` → `uuid` (lewat alat drift, bukan test) | `drift-check --compare` |
| 12 | hapus CHECK `platform_logos_key_format` (lewat alat drift) | `drift-check --compare` |
| 13 | hapus satu policy RLS `transactions` (lewat alat drift) | `drift-check --compare` |
| 14 | longgarkan policy jadi `using (true)` (lewat alat drift) | `drift-check --compare` |

Butir 13 dan 14 yang paling penting: **kebocoran RLS kini membuat CI merah**, dan
sebelum v124 tidak ada satu pun penjaga yang bisa melihatnya.

### 9.4 Yang sengaja TIDAK diubah

- **`rls_auto_enable` + event trigger `ensure_rls`** tetap hanya di produksi.
  `schema.sql` baris 54-57 menyatakannya OPSIONAL karena butuh hak superuser dan
  keputusan sadar. Alat drift mencatatnya di `DIHARAPKAN_HANYA_DI_LIVE`, dan
  `drift-check-contract.test.js` menuntut namanya tetap disebut di `schema.sql`
  supaya izin itu tidak jadi tempat menyembunyikan drift.
- **Baris `ipot`** di `platform_logos` (nonaktif) tetap ada di produksi. Repo
  sengaja tidak men-seed-nya, aplikasi memfilter `is_active = true`, jadi baris
  itu tidak pernah tampil. Menghapusnya bukan bagian dari perbaikan drift.
- **Default privilege Supabase** (`anon` punya hak DML luas di tabel `public`)
  tidak disentuh. RLS aktif di 11/11 tabel dan itulah yang menahan. Mencabut hak
  itu akan menambah satu lapis pertahanan, tapi merupakan keputusan terpisah —
  lihat catatan di §4.
- **`check_and_consume_rate_limit`** tidak di-`create or replace` ulang ke
  produksi. Kodenya sudah identik (F8); menimpanya hanya untuk menyamakan
  komentar berarti menyentuh RPC keamanan yang sedang bekerja tanpa alasan.
