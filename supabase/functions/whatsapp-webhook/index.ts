// supabase/functions/whatsapp-webhook/index.ts
// ============================================================
// Menerima webhook dari Fonnte tiap kali ada pesan WhatsApp masuk ke nomor bot,
// lalu: (1) proses link nomor <-> akun, (2) parse pesan jadi transaksi, (3) simpan
// ke tabel `transactions` yang SAMA dipakai aplikasi web, (4) balas konfirmasi.
//
// SECRETS yang wajib diset (Supabase Dashboard > Edge Functions > Secrets, atau
// lewat `supabase secrets set`):
//   FONNTE_TOKEN             -- token device dari dashboard Fonnte (Device > lihat Token)
//   WHATSAPP_WEBHOOK_SECRET  -- string rahasia buatan sendiri (bebas), dipakai supaya
//                                cuma Fonnte yang bisa manggil webhook ini, bukan sembarang
//                                orang di internet (lihat instruksi setup)
//   GEMINI_API_KEY           -- SUDAH ADA (dipakai analyze-finance), dipakai ulang di sini
//                                utk parsing bahasa natural. Fitur bahasa natural otomatis
//                                nonaktif kalau secret ini belum diset (fallback ke format
//                                cepat "catat ..." tetap jalan).
// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY sudah otomatis tersedia di semua Edge Function,
// tidak perlu diset manual.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FONNTE_TOKEN = Deno.env.get('FONNTE_TOKEN') ?? '';
const WEBHOOK_SECRET = Deno.env.get('WHATSAPP_WEBHOOK_SECRET') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = 'gemini-3.6-flash'; // samain dgn yang sudah dipakai di analyze-finance

// Rate limit khusus jalur Gemini (parseWithGemini) -- lihat sql/migration_rate_limiting_2026-08.sql.
// parseStrictCommand (format cepat "catat ...") TIDAK kena limit ini krn gratis/tanpa panggilan
// API eksternal -- cuma bahasa natural yang beneran manggil Gemini yang dibatasi.
const RATE_LIMIT_ACTION = 'whatsapp-gemini-parse';
const RATE_LIMIT_MAX_CALLS = 30;
const RATE_LIMIT_WINDOW_MINUTES = 60;

// Perbandingan string BIASA (`===`/`!==`) berhenti di karakter pertama yang beda -- secara teori
// bisa dipakai penyerang menebak WEBHOOK_SECRET karakter-per-karakter dari selisih waktu respons
// (timing attack). Risikonya rendah utk endpoint ini (perlu ribuan percobaan presisi lewat
// internet), tapi perbandingan constant-time ini tanpa dependency tambahan, jadi tidak ada
// alasan tidak dipasang.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type ParsedTx = {
  jenis: 'Pengeluaran' | 'Pemasukan';
  jumlah: number;
  kategori: string;
  keterangan: string | null;
};

// "Hari ini" dalam WIB (UTC+7), BUKAN waktu server. Edge Function jalan di server yang
// timezone-nya bisa apa saja (biasanya UTC) -- jadi tidak bisa pakai waktu lokal server
// sama sekali. Trik: geser timestamp UTC maju 7 jam, baru ambil komponen tanggalnya --
// hasilnya jadi tanggal kalender WIB yang benar. (Lihat juga pelajaran yang sama soal
// toDateStr()/todayDateStr() di index.html -- ini versi server-side dari masalah yang sama.
// CATATAN: asumsi WIB (UTC+7) utk semua user -- kalau user di WITA/WIT, tanggal transaksi
// via WhatsApp bisa meleset di jam-jam awal hari; app web tetap pakai timezone browser
// masing-masing user jadi tidak kena isu ini.)
function todayWIB(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.startsWith('0') ? '62' + digits.slice(1) : digits;
}

function formatRp(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

async function sendReply(target: string, message: string): Promise<void> {
  try {
    await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: FONNTE_TOKEN },
      body: JSON.stringify({ target, message }),
    });
  } catch (e) {
    console.error('Gagal kirim balasan lewat Fonnte:', e);
  }
}

// Format cepat, tanpa AI, tanpa syarat GEMINI_API_KEY: "catat <keluar|masuk> <jumlah> <kategori> [keterangan...]"
// jumlah boleh pakai singkatan: 25000, 25rb, 25ribu, 1.5jt, 2juta
function parseStrictCommand(text: string): ParsedTx | null {
  const m = text.trim().match(/^catat\s+(keluar|masuk)\s+(\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta)?\s+(\S+)(?:\s+(.*))?$/i);
  if (!m) return null;
  let jumlah = parseFloat(m[2].replace(',', '.'));
  const unit = (m[3] || '').toLowerCase();
  if (unit === 'rb' || unit === 'ribu' || unit === 'k') jumlah *= 1000;
  if (unit === 'jt' || unit === 'juta') jumlah *= 1000000;
  if (!jumlah || jumlah <= 0) return null;
  return {
    jenis: m[1].toLowerCase() === 'keluar' ? 'Pengeluaran' : 'Pemasukan',
    jumlah: Math.round(jumlah),
    kategori: m[4],
    keterangan: m[5] || null,
  };
}

// Bahasa natural lewat Gemini (dipakai kalau format cepat di atas tidak cocok). Dikasih
// daftar kategori kustom user sbg konteks supaya AI condong milih yg sudah ada drpd
// bikin kategori baru terus-menerus -- tapi TIDAK memaksa (kategori baru tetap boleh,
// nanti tampil dgn ikon default di app sampai user atur sendiri di Pengaturan).
async function parseWithGemini(text: string, knownCategories: string[]): Promise<ParsedTx | null> {
  if (!GEMINI_API_KEY) return null;
  const prompt = `Kamu asisten pencatatan keuangan pribadi. Baca SATU pesan WhatsApp dan ubah jadi data transaksi.
Balas HANYA JSON murni (tanpa markdown/backtick/penjelasan), persis format ini:
{"jenis":"Pengeluaran","jumlah":25000,"kategori":"Transportasi","keterangan":"parkir motor"}
jenis harus "Pengeluaran" atau "Pemasukan". jumlah dalam Rupiah, angka bulat tanpa titik/koma pemisah ribuan.
keterangan boleh null kalau tidak ada detail tambahan selain kategori.

Kategori yang sudah dipakai user (pilih salah satu ini kalau cocok, atau buat kategori baru singkat kalau tidak ada yang pas): ${knownCategories.length ? knownCategories.join(', ') : '(belum ada kategori kustom)'}

Kalau pesan ini TIDAK mengandung informasi transaksi keuangan yang jelas (tidak ada jumlah uang), balas persis: {"error":"tidak_valid"}

Pesan: "${text}"`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) {
      console.error('Gemini API error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed.error) return null;
    if (!parsed.jenis || !parsed.jumlah || !parsed.kategori) return null;
    if (parsed.jenis !== 'Pengeluaran' && parsed.jenis !== 'Pemasukan') return null;
    const jumlah = Math.round(Number(parsed.jumlah));
    if (!jumlah || jumlah <= 0) return null;
    return { jenis: parsed.jenis, jumlah, kategori: String(parsed.kategori), keterangan: parsed.keterangan || null };
  } catch (e) {
    console.error('Gagal parse balasan Gemini:', e);
    return null;
  }
}

const HELP_TEXT =
  'Panduan Bot MyFinance\n\n' +
  'Catat transaksi langsung dari chat ini, contoh:\n' +
  '- "keluar 25000 buat parkir"\n' +
  '- "gaji masuk 5jt"\n' +
  '- format cepat: "catat keluar 25000 Transportasi parkir motor"\n\n' +
  'Perintah lain:\n' +
  '- BANTUAN -- tampilkan pesan ini\n' +
  '- UNLINK -- putuskan nomor ini dari akun MyFinance';

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const providedToken = url.searchParams.get('token') ?? '';
    if (!WEBHOOK_SECRET || !constantTimeEqual(providedToken, WEBHOOK_SECRET)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return new Response('OK', { status: 200 });

    const sender = normalizePhone(String(body.sender ?? body.member ?? ''));
    const messageText = String(body.message ?? body.text ?? '').trim();
    if (!sender || !messageText) return new Response('OK', { status: 200 });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ---------- Perintah: LINK <kode> ----------
    const linkMatch = messageText.match(/^link\s+(\d{4,8})$/i);
    if (linkMatch) {
      const code = linkMatch[1];
      const { data: codeRow } = await supabase
        .from('whatsapp_link_codes')
        .select('user_id, expires_at')
        .eq('code', code)
        .maybeSingle();

      if (!codeRow || new Date(codeRow.expires_at) < new Date()) {
        await sendReply(sender, 'Kode tidak ditemukan atau sudah kadaluarsa. Buka Pengaturan > Hubungkan WhatsApp di app buat dapetin kode baru.');
        return new Response('OK', { status: 200 });
      }

      await supabase
        .from('whatsapp_links')
        .upsert({ user_id: codeRow.user_id, whatsapp_number: sender, linked_at: new Date().toISOString() }, { onConflict: 'user_id' });
      await supabase.from('whatsapp_link_codes').delete().eq('code', code);

      await sendReply(sender, '✅ Berhasil terhubung ke akun MyFinance kamu!\n\nSekarang langsung catat transaksi lewat chat ini, contoh: "keluar 25000 parkir".\nKetik BANTUAN buat panduan lengkap.');
      return new Response('OK', { status: 200 });
    }

    // ---------- Perintah: BANTUAN ----------
    if (/^(bantuan|help|menu)$/i.test(messageText)) {
      await sendReply(sender, HELP_TEXT);
      return new Response('OK', { status: 200 });
    }

    // ---------- Cari akun MyFinance pemilik nomor ini ----------
    const { data: link } = await supabase.from('whatsapp_links').select('user_id').eq('whatsapp_number', sender).maybeSingle();

    // ---------- Perintah: UNLINK ----------
    if (/^unlink$/i.test(messageText)) {
      if (link) {
        await supabase.from('whatsapp_links').delete().eq('user_id', link.user_id);
        await sendReply(sender, 'Nomor ini sudah diputus dari akun MyFinance kamu. Kirim LINK <kode> lagi kapan saja kalau mau sambung ulang.');
      } else {
        await sendReply(sender, 'Nomor ini belum terhubung ke akun manapun.');
      }
      return new Response('OK', { status: 200 });
    }

    if (!link) {
      await sendReply(sender, 'Nomor ini belum terhubung ke akun MyFinance.\n\nBuka Pengaturan > Hubungkan WhatsApp di app, lalu kirim ke sini: LINK <kode 6 digit yang muncul>');
      return new Response('OK', { status: 200 });
    }
    const userId: string = link.user_id;

    // ---------- Ambil accounts & kategori kustom user, buat konteks parsing ----------
    const { data: settingsRow } = await supabase.from('settings').select('data').eq('user_id', userId).maybeSingle();
    const userSettings = settingsRow?.data || {};
    const accounts: string[] = userSettings.accounts || [];
    const customCatNames: string[] = [
      ...((userSettings.custom_categories?.pengeluaran?.parents || []) as Array<{ name: string }>).map((p) => p.name),
      ...((userSettings.custom_categories?.pemasukan?.parents || []) as Array<{ name: string }>).map((p) => p.name),
    ];

    // ---------- Parse pesan: format cepat dulu (gratis, cepat), baru AI kalau tidak cocok ----------
    let parsed = parseStrictCommand(messageText);
    if (!parsed) {
      const { data: allowed, error: rateLimitErr } = await supabase.rpc('check_and_consume_rate_limit', {
        p_user_id: userId,
        p_action: RATE_LIMIT_ACTION,
        p_max_calls: RATE_LIMIT_MAX_CALLS,
        p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
      });
      // Fail-open kalau RPC-nya sendiri error (mis. migrasi rate_limits belum diterapkan) --
      // jangan sampai fitur WhatsApp mati total gara-gara masalah infra rate-limiting yang tidak
      // ada hubungannya. Kalau RPC berhasil dipanggil dan hasilnya false, itu baru diblokir.
      if (!rateLimitErr && allowed === false) {
        await sendReply(sender, `Terlalu banyak pesan bahasa natural dalam ${RATE_LIMIT_WINDOW_MINUTES} menit terakhir. Coba format cepat dulu ya: "catat keluar 25000 Transportasi parkir", atau tunggu sebentar.`);
        return new Response('OK', { status: 200 });
      }
      parsed = await parseWithGemini(messageText, customCatNames);
    }

    if (!parsed) {
      await sendReply(sender, 'Maaf, aku belum paham maksudnya. Coba: "keluar 25000 buat parkir", atau ketik BANTUAN buat panduan format.');
      return new Response('OK', { status: 200 });
    }

    // Akun: pakai yang namanya disebut di pesan (kalau ada & cocok), atau akun pertama
    // user sbg default. Ini penyederhanaan yang disengaja utk versi awal -- kalau user
    // punya banyak akun & sering ganti-ganti, sebutkan nama akunnya di pesan supaya
    // ke-deteksi (mis. "keluar 25000 parkir dari BCA").
    const lowerMsg = messageText.toLowerCase();
    const akun = accounts.find((a) => lowerMsg.includes(a.toLowerCase())) || accounts[0] || 'Tunai';

    const { error: insertError } = await supabase.from('transactions').insert({
      user_id: userId,
      jenis: parsed.jenis,
      tanggal: todayWIB(),
      jumlah: parsed.jumlah,
      akun,
      kategori: parsed.kategori,
      keterangan: parsed.keterangan,
      mata_uang: null,
      kurs: null,
      jumlah_idr: parsed.jumlah,
    });

    if (insertError) {
      console.error('Gagal insert transaksi dari WhatsApp:', insertError);
      await sendReply(sender, 'Waduh, gagal menyimpan transaksinya. Coba lagi sebentar lagi ya.');
      return new Response('OK', { status: 200 });
    }

    const jenisLabel = parsed.jenis === 'Pengeluaran' ? 'Pengeluaran' : 'Pemasukan';
    await sendReply(
      sender,
      `✅ Tercatat!\n${jenisLabel}: Rp${formatRp(parsed.jumlah)}\nKategori: ${parsed.kategori}` +
        (parsed.keterangan ? `\nCatatan: ${parsed.keterangan}` : '') +
        `\nAkun: ${akun}`
    );
    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Error tak terduga di whatsapp-webhook:', e);
    // Tetap balas 200 supaya Fonnte tidak menganggap gagal & mengulang kirim webhook
    // yang sama berkali-kali (lihat catatan retry di panduan setup).
    return new Response('OK', { status: 200 });
  }
});
