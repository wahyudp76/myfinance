// GUARD: angka di dokumen harus cocok dengan kenyataan di kode.
//
// Latar (v96): audit struktur repo menemukan sederet klaim basi yang menyesatkan
// pembaca baru (termasuk agen AI berikutnya) -- STRUKTUR-REPO menulis
// "CACHE_VERSION=v70" saat sw.js sudah v131, "37 file" domain saat isinya 38,
// "65 cek" saat verify-hud sudah 69, dan komentar dependabot masih menyebut
// supabase-js dimuat dari esm.sh padahal sudah di-vendor sejak v59. Dokumen di
// repo ini bukan hiasan: AGENT-HANDOFF & STRUKTUR-REPO adalah alat kerja utama
// tiap sesi, jadi angka yang salah = keputusan yang salah.
//
// Test ini menagih konsistensi angka SECARA MEKANIS, bukan lewat kedisiplinan.
// Kalau sebuah "pola jangkar" tidak ketemu lagi (kalimatnya ditulis ulang),
// test ini juga merah -- itu disengaja: perbarui jangkarnya di sini bersama
// dokumennya, jangan biarkan gerbangnya diam-diam berhenti menjaga.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

const struktur = read("STRUKTUR-REPO.md");
const readme = read("README.md");
const handoff = read("AGENT-HANDOFF.md");

// AGENT-HANDOFF.md diperiksa TERBATAS. Yang ikut dijaga: (a) nomor entri terakhir
// (harus = "versi terbaru" di header STRUKTUR-REPO), dan (b) blok "## Peta cepat" --
// bagian itu menggambarkan kondisi SEKARANG dan dibaca pertama oleh tiap sesi/agen.
// Entri "## vNN" di bawahnya SENGAJA dikecualikan: isinya log historis per versi
// (entri v45 memang harus tetap menulis "500 unit test" -- itu fakta saat itu).
const petaCepat = handoff.split(/^## /m)[1] || "";
assert.ok(petaCepat.startsWith("Peta cepat"),
  "blok '## Peta cepat' tidak lagi jadi bagian pertama AGENT-HANDOFF.md -- guard di bawah akan diam-diam berhenti menjaga.");

test("dokumen: CACHE_VERSION yang disebut cocok dengan sw.js", () => {
  const actual = read("sw.js").match(/CACHE_VERSION\s*=\s*['"]myfinance-v(\d+)['"]/)?.[1];
  assert.ok(actual, "CACHE_VERSION tidak terbaca dari sw.js -- formatnya berubah?");

  for (const [name, text] of [["STRUKTUR-REPO.md", struktur], ["README.md", readme]]) {
    for (const m of text.matchAll(/CACHE_VERSION\s*=\s*'?(?:myfinance-)?v(\d+)/g)) {
      assert.equal(
        m[1], actual,
        `${name} menyebut CACHE_VERSION=v${m[1]} padahal sw.js sudah v${actual}. ` +
        `Perbarui dokumennya (atau bump sw.js kalau memang aset berubah).`
      );
    }
  }
});

test("dokumen: versi terbaru di STRUKTUR-REPO = entri terakhir AGENT-HANDOFF", () => {
  const versions = [...handoff.matchAll(/^## v(\d+)\b/gm)].map((m) => Number(m[1]));
  assert.ok(versions.length > 5, "entri versi di AGENT-HANDOFF tidak terbaca -- format '## vNN' berubah?");
  const latest = Math.max(...versions);

  const claimed = struktur.match(/versi terbaru `v(\d+)`/);
  assert.ok(claimed, "pola 'versi terbaru `vNN`' hilang dari header STRUKTUR-REPO.md");
  assert.equal(
    Number(claimed[1]), latest,
    `STRUKTUR-REPO menulis versi terbaru v${claimed[1]}, tapi entri terakhir AGENT-HANDOFF v${latest}. ` +
    `Perbarui header STRUKTUR-REPO.md setiap menambah entri handoff.`
  );
});

test("dokumen: jumlah file src/domain & src/ui cocok dengan isi folder", () => {
  const count = (dir) => readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith(".js")).length;

  const domainLine = struktur.split("\n").find((l) => l.includes("domain/") && /\d+ file/.test(l));
  assert.ok(domainLine, "baris ringkasan 'domain/ ... NN file' hilang dari STRUKTUR-REPO.md");
  assert.equal(
    Number(domainLine.match(/(\d+) file/)[1]), count("src/domain"),
    `STRUKTUR-REPO menulis "${domainLine.trim()}" padahal src/domain berisi ${count("src/domain")} file.`
  );
});

test("dokumen: jumlah tabel & RPC cocok dengan sql/schema.sql", () => {
  const schema = read("sql/schema.sql");
  const tables = (schema.match(/^create table if not exists/gim) || []).length;
  const rpcs = (schema.match(/^create or replace function/gim) || []).length;
  assert.ok(tables > 5 && rpcs > 0, "parser schema.sql rusak?");

  // Jangkar spesifik supaya kalimat lain yang kebetulan memuat angka + "tabel"
  // (mis. "menambah 1 tabel baru") tidak ikut tertangkap.
  const anchors = [
    [readme, "README.md", /Ini membuat (\d+) tabel berikut/, tables],
    [readme, "README.md", /dijalankan lengkap \(semua (\d+) tabel/, tables],
    [readme, "README.md", /\((\d+) tabel \+ \d+ RPC/, tables],
    [readme, "README.md", /\(\d+ tabel \+ (\d+) RPC/, rpcs],
    [readme, "README.md", /Run cukup\): (\d+) tabel/, tables],
    [struktur, "STRUKTUR-REPO.md", /#\s+(\d+) tabel \(transactions/, tables],
    [struktur, "STRUKTUR-REPO.md", /\*\*Tabel Supabase \((\d+)\)\*\*/, tables],
  ];

  for (const [text, name, re, expected] of anchors) {
    const m = text.match(re);
    assert.ok(m, `pola ${re} tidak ketemu di ${name} -- kalimatnya ditulis ulang? Perbarui jangkar di test ini.`);
    assert.equal(
      Number(m[1]), expected,
      `${name} menyebut ${m[1]} lewat pola ${re}, kenyataan di sql/schema.sql = ${expected}.`
    );
  }
});

test("vendor: versi bundel browser supabase-js = versi paket npm", () => {
  // Kopling yang tidak kelihatan: browser memuat vendor/supabase-js-X.bundle.min.mjs
  // (di-pin di nama berkas), sementara skrip parity sisi Node memakai paket npm
  // @supabase/supabase-js. Dependabot hanya menaikkan yang npm. Tanpa gerbang ini
  // keduanya bisa berpisah jalan berbulan-bulan tanpa satu pun test merah, dan
  // parity "live" jadi menguji versi klien yang TIDAK dipakai pengguna.
  const vendored = readdirSync(resolve(ROOT, "vendor"))
    .map((f) => f.match(/^supabase-js-(\d+\.\d+\.\d+)\.bundle\.min\.mjs$/))
    .filter(Boolean);
  assert.equal(vendored.length, 1, `harus ada tepat 1 bundel supabase-js di vendor/, ketemu ${vendored.length}`);

  const pkg = JSON.parse(read("package.json"));
  const npmVersion = (pkg.devDependencies["@supabase/supabase-js"] || "").replace(/^[\^~]/, "");
  assert.equal(
    vendored[0][1], npmVersion,
    `vendor/ memuat supabase-js ${vendored[0][1]} tapi package.json meminta ${npmVersion}.\n` +
    `  Kalau ini datang dari PR Dependabot: bundel browser TIDAK ikut naik sendiri.\n` +
    `  Ikuti prosedur vendor ulang di vendor/README.md (unduh bundel versi baru,\n` +
    `  perbarui import di src/services/supabase/client.js + precache sw.js + bump CACHE_VERSION),\n` +
    `  atau turunkan kembali versi npm-nya kalau memang belum mau pindah.`
  );
});

test("dokumen: jumlah cek tiap harness E2E cocok dengan skripnya", () => {
  // Tiap harness mendaftarkan cek lewat helper ok(...) -- hitung pemanggilannya.
  // Latar v88: harness manual jadi basi berbulan-bulan tanpa ketahuan karena
  // tidak ada yang mencocokkan angka di dokumen dengan isi skripnya.
  const harnesses = ["verify-hud", "verify-asset-logos", "verify-applock", "verify-applock-biometric", "verify-offline-cache", "verify-ui-actions", "verify-csp", "verify-ui-sweep", "verify-applock-rpid"];
  const actual = Object.fromEntries(
    harnesses.map((h) => [h, (read(`scripts/${h}.mjs`).match(/\bok\(/g) || []).length])
  );
  for (const [h, n] of Object.entries(actual)) {
    assert.ok(n > 5, `hitungan cek ${h} mencurigakan (${n}) -- helper ok() diganti nama?`);
  }

  const docs = [
    ["STRUKTUR-REPO.md", struktur],
    ["README.md", readme],
    [".github/workflows/e2e-harness.yml", read(".github/workflows/e2e-harness.yml")],
    // Hanya blok "Peta cepat" AGENT-HANDOFF: bagian itu SEHARUSNYA selalu
    // menggambarkan kondisi sekarang (v97 menemukannya masih menulis 49 cek
    // padahal sudah 69). Entri "## vNN" di bawahnya tetap dikecualikan.
    ["AGENT-HANDOFF.md (Peta cepat)", petaCepat],
  ];

  let checked = 0;
  for (const [name, text] of docs) {
    for (const line of text.split("\n")) {
      // "verify-applock" adalah AWALAN dari "verify-applock-biometric" -- kalau
      // dicocokkan apa adanya, baris tentang harness biometrik (14 cek) akan
      // dinilai memakai angka harness applock (21) dan guard ini jadi bohong.
      // Ambil nama TERPANJANG yang cocok pada baris itu saja.
      const match = harnesses
        .filter((h) => line.includes(h))
        .sort((a, b) => b.length - a.length)[0];
      if (!match) continue;
      for (const m of line.matchAll(/(\d+)\s*cek/g)) {
        assert.equal(
          Number(m[1]), actual[match],
          `${name} menyebut "${m[1]} cek" untuk ${match}, padahal skripnya punya ${actual[match]} pemanggilan ok().\n` +
          `  Baris: ${line.trim()}`
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 5, `hanya ${checked} klaim jumlah cek yang terperiksa -- pola penyebutan berubah?`);
});

// ============================================================================
// v122: jangkar baru -- kelas drift yang lolos dari guard di atas.
//
// Latar (audit dokumen 2026-09-12): sederet klaim naratif ternyata basi tanpa
// satu pun test merah -- README menyebut "konfigurasi Supabase ada di index.html"
// (padahal sejak v54 di app.src.js), "semua 8 modal" (padahal 19), "maks 1MB"
// (padahal 8MB sejak perbaikan di §8 README), "2 Edge Function" (padahal 5);
// STRUKTUR-REPO menyebut "200+ atribut onclick=" (padahal 0 sejak v101-v102),
// "boot.js" sebagai module yang dimuat (padahal boot.bundle.js sejak v103),
// "50+ file uji" (padahal 89), "ESLint 9" (padahal 10), dan menggambarkan
// src/bootstrap/ sebagai jalur boot produksi (padahal tidak ter-wire sama sekali).
// Guard di bawah menagih klaim-klaim itu SECARA MEKANIS, sama seperti guard v97.
// ============================================================================

/** Jumlah modul .js di sebuah folder (rekursif) -- dipakai utk klaim "N modul src/". */
function countModules(dir) {
  let total = 0;
  for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) total += countModules(`${dir}/${entry.name}`);
    else if (entry.name.endsWith(".js")) total += 1;
  }
  return total;
}

/** Nama aksi yang terdaftar di registry __uiActionsCache (dibangun malas saat klik pertama). */
function uiActionRegistry() {
  const app = read("app.src.js");
  const marker = "__uiActionsCache = {";
  const start = app.indexOf(marker);
  assert.ok(start >= 0, "pola '__uiActionsCache = {' hilang dari app.src.js -- bentuk registry berubah? perbarui guard ini.");
  const open = start + marker.length - 1;                       // indeks "{" pembuka
  let depth = 0;
  let close = -1;
  for (let i = open; i < app.length; i += 1) {
    if (app[i] === "{") depth += 1;
    else if (app[i] === "}") { depth -= 1; if (depth === 0) { close = i; break; } }
  }
  assert.ok(close > open, "kurung kurawal registry aksi tidak seimbang di app.src.js.");
  const body = app.slice(open + 1, close).replace(/\/\/[^\n]*/g, "");  // buang komentar // per baris
  const names = body.split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s));
  assert.ok(names.length > 100, `registry aksi cuma terbaca ${names.length} entri -- parser guard ini rusak?`);
  return new Set(names);
}

/**
 * Atribut event deklaratif yang dilayani dispatcher (dibaca dari UI_EVENT_ATTR di
 * app.src.js, jadi otomatis ikut kalau ada event ketujuh ditambahkan).
 *
 * v123: guard v122 hanya memeriksa `data-action`, padahal dispatcher melayani
 * ENAM atribut lain (data-on-change/input/submit/keydown/focus/blur = 67 atribut
 * di markup). Komentar di app.src.js:1470-1474 justru menjelaskan bahayanya:
 * handler yang tidak terdaftar membuat fitur mati "tanpa error, cuma diam".
 */
function uiEventAttrs() {
  const app = read("app.src.js");
  const m = app.match(/const UI_EVENT_ATTR = \{([\s\S]*?)\};/);
  assert.ok(m, "pola 'const UI_EVENT_ATTR = { ... };' hilang dari app.src.js -- bentuk dispatcher berubah? perbarui guard ini.");
  const attrs = [...m[1].matchAll(/\w+:\s*'([^']+)'/g)].map((x) => x[1]);
  assert.ok(attrs.length >= 6, `UI_EVENT_ATTR cuma ${attrs.length} entri -- parser guard ini rusak?`);
  assert.ok(attrs.every((a) => a.startsWith("data-on-")), `UI_EVENT_ATTR berisi atribut tak terduga: ${attrs.join(", ")}`);
  return attrs;
}

test("markup: 0 handler inline, dan SEMUA data-action/data-on-* terdaftar di registry", () => {
  const html = read("index.html");
  const handler = /\son(?:click|change|input|submit|keydown|keyup|keypress|focus|blur|load|error|mouse\w+)\s*=/gi;
  const inline = html.match(handler) || [];
  assert.deepEqual(inline, [],
    `index.html punya ${inline.length} atribut handler inline (${inline.slice(0, 5).join(", ")}). ` +
    `CSP script-src tanpa 'unsafe-inline' MENOLAK menjalankannya -- fitur hilang diam-diam. ` +
    `Pakai data-action="..." / data-on-*="..." lalu daftarkan di registry __uiActionsCache (app.src.js).`);

  const registry = uiActionRegistry();

  let total = 0;
  for (const atr of ["data-action", ...uiEventAttrs()]) {
    const names = [...html.matchAll(new RegExp(`${atr}="([^"]+)"`, "g"))].map((m) => m[1]);
    total += names.length;
    const bolong = [...new Set(names)].filter((a) => !registry.has(a));
    assert.deepEqual(bolong, [],
      `${atr}= di index.html TIDAK ada di registry __uiActionsCache (handler mati, TANPA error): ${bolong.join(", ")}`);
  }
  assert.ok(total > 150,
    `cuma ${total} atribut aksi deklaratif di index.html (diharapkan >150) -- parser guard ini rusak?`);

  // HTML yang dihasilkan runtime memakai uiActionAttrs() (src/domain/sanitize.js).
  const dinamis = [...new Set([...read("app.src.js").matchAll(/uiActionAttrs\(\s*'([^']+)'/g)].map((m) => m[1]))];
  const dinamisBolong = dinamis.filter((a) => !registry.has(a));
  assert.deepEqual(dinamisBolong, [],
    `aksi dinamis dari uiActionAttrs() TIDAK ada di registry: ${dinamisBolong.join(", ")}`);
});

test("dokumen: konstanta Supabase & nomor bot WhatsApp ada di app.src.js (bukan index.html)", () => {
  const app = read("app.src.js");
  const html = read("index.html");
  for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "WHATSAPP_BOT_NUMBER"]) {
    const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=`);
    assert.ok(re.test(app), `${name} tidak didefinisikan di app.src.js -- pindah lagi? perbarui dokumen + guard ini.`);
    assert.ok(!re.test(html),
      `${name} ternyata (juga) didefinisikan di index.html, padahal README §7 dan STRUKTUR-REPO §2 menyatakan app.src.js.`);
  }
  const jangkar = [
    [readme, "README.md", /Konfigurasi URL & anon key ada di dalam \*\*`app\.src\.js`\*\*/],
    [readme, "README.md", /buka \*\*`app\.src\.js`\*\* \(bukan `index\.html`\)/],
    [struktur, "STRUKTUR-REPO.md", /SUPABASE_URL \/ SUPABASE_ANON_KEY \/ WHATSAPP_BOT_NUMBER/],
    [struktur, "STRUKTUR-REPO.md", /ada di \*\*`app\.src\.js`\*\* di bawah komentar/],
  ];
  for (const [text, name, re] of jangkar) {
    assert.ok(re.test(text), `jangkar ${re} hilang dari ${name} -- kalimatnya ditulis ulang? perbarui jangkar di guard ini.`);
  }
});

test("dokumen: jumlah modal & view di README + STRUKTUR-REPO = kenyataan di index.html", () => {
  const html = read("index.html");
  const dialogs = (html.match(/role="dialog"/g) || []).length;
  const ariaModal = (html.match(/aria-modal="true"/g) || []).length;
  assert.equal(dialogs, ariaModal,
    `setiap role="dialog" wajib ber-aria-modal="true" (ketemu ${dialogs} vs ${ariaModal})`);

  const views = new Set([...html.matchAll(/id="view-[a-z-]+"/g)].map((x) => x[0])).size;
  assert.ok(views >= 5, `hanya ${views} view unik di index.html -- parser guard ini rusak?`);

  const m = readme.match(/semua (\d+) modal sekarang punya `role="dialog"`/);
  assert.ok(m, 'jangkar \'semua N modal sekarang punya `role="dialog"`\' hilang dari README.md §6');
  assert.equal(Number(m[1]), dialogs, `README menyebut ${m[1]} modal, index.html punya ${dialogs} role="dialog".`);

  // Klaim gabungan "N view + M modal" muncul di tree README, tree STRUKTUR-REPO, dan
  // diagram §4 STRUKTUR-REPO -- ketiganya ditagih sekaligus.
  for (const [text, name, re] of [
    [readme, "README.md", /Markup (\d+) view \+ (\d+) modal/],
    [struktur, "STRUKTUR-REPO.md", /Markup (\d+) view \+ (\d+) modal/],
    [struktur, "STRUKTUR-REPO.md", /index\.html: (\d+) view \+ (\d+) modal/],
  ]) {
    const v = text.match(re);
    assert.ok(v, `jangkar ${re} hilang dari ${name}`);
    assert.equal(Number(v[1]), views, `${name} menyebut ${v[1]} view, index.html punya ${views}.`);
    assert.equal(Number(v[2]), dialogs, `${name} menyebut ${v[2]} modal, index.html punya ${dialogs}.`);
  }

  // "Peta cepat" AGENT-HANDOFF menyebut keduanya dengan format tebal (**N**) tersendiri.
  const petaView = petaCepat.match(/\*\*(\d+)\*\* view/);
  assert.ok(petaView, "jangkar '**N** view' hilang dari AGENT-HANDOFF.md (Peta cepat)");
  assert.equal(Number(petaView[1]), views, `Peta cepat menyebut ${petaView[1]} view, index.html punya ${views}.`);

  const petaModal = petaCepat.match(/\*\*(\d+)\*\* modal ber-`role="dialog"`/);
  assert.ok(petaModal, 'jangkar \'**N** modal ber-`role="dialog"`\' hilang dari AGENT-HANDOFF.md (Peta cepat)');
  assert.equal(Number(petaModal[1]), dialogs, `Peta cepat menyebut ${petaModal[1]} modal, index.html punya ${dialogs}.`);
});

test("dokumen: jumlah file test unit & Edge Function = kenyataan di folder", () => {
  const tests = readdirSync(resolve(ROOT, "tests/unit")).filter((f) => f.endsWith(".test.js")).length;
  assert.ok(tests > 50, `hanya ${tests} file test unit -- foldernya pindah?`);
  for (const [text, name, re] of [
    [struktur, "STRUKTUR-REPO.md", /(\d+) file \*\.test\.js murni/],
    [readme, "README.md", /(\d+) file test murni/],
  ]) {
    const m = text.match(re);
    assert.ok(m, `jangkar ${re} hilang dari ${name}`);
    assert.equal(Number(m[1]), tests, `${name} menyebut ${m[1]} file test unit, kenyataan ${tests}.`);
  }

  const dir = resolve(ROOT, "supabase/functions");
  const fns = readdirSync(dir)
    .filter((d) => d !== "_shared" && statSync(resolve(dir, d)).isDirectory())
    .sort();
  assert.ok(fns.length >= 4, `hanya ${fns.length} Edge Function -- foldernya berubah?`);
  for (const [text, name, re] of [
    [readme, "README.md", /# (\d+) Edge Function \(Deno\)/],
    [struktur, "STRUKTUR-REPO.md", /# (\d+) Edge Function \(Deno\)/],
  ]) {
    const m = text.match(re);
    assert.ok(m, `jangkar ${re} hilang dari ${name}`);
    assert.equal(Number(m[1]), fns.length,
      `${name} menyebut ${m[1]} Edge Function, kenyataan ${fns.length} (${fns.join(", ")}).`);
  }
  // Dulu hanya 2 dari 5 yang terdaftar di tree README -- tiap nama wajib disebut.
  const takDisebut = fns.filter((f) => !readme.includes(`${f}/`));
  assert.deepEqual(takDisebut, [], `Edge Function ini tidak disebut di tree README.md §1: ${takDisebut.join(", ")}`);

  // "Peta cepat" AGENT-HANDOFF dulu cuma menyebut 2 dari 5 nama.
  const petaFn = petaCepat.match(/\*\*(\d+)\*\* Edge Functions/);
  assert.ok(petaFn, "jangkar '**N** Edge Functions' hilang dari AGENT-HANDOFF.md (Peta cepat)");
  assert.equal(Number(petaFn[1]), fns.length, `Peta cepat menyebut ${petaFn[1]} Edge Function, kenyataan ${fns.length}.`);
  const hilangDiPeta = fns.filter((f) => !petaCepat.includes(`\`${f}\``));
  assert.deepEqual(hilangDiPeta, [], `Edge Function ini tidak disebut di AGENT-HANDOFF.md (Peta cepat): ${hilangDiPeta.join(", ")}`);
});

test("dokumen: yang dimuat index.html adalah boot.bundle.js, dan jumlah modul src/ cocok", () => {
  const html = read("index.html");
  assert.ok(/<script type="module" src="\.\/boot\.bundle\.js"><\/script>/.test(html),
    'index.html tidak lagi memuat <script type="module" src="./boot.bundle.js"> -- bentuknya berubah? perbarui guard + dokumen.');
  assert.ok(!/<script[^>]+src="\.\/boot\.js"/.test(html),
    "index.html memuat boot.js langsung, padahal boot.bundle.js (v103) yang seharusnya dimuat.");

  for (const [text, name, re] of [
    [struktur, "STRUKTUR-REPO.md", /\*\*`boot\.bundle\.js`\*\* adalah bundel esbuild/],
    [struktur, "STRUKTUR-REPO.md", /# OUTPUT build esbuild: boot\.js \+ (\d+) modul src\//],
    [readme, "README.md", /# OUTPUT BUILD boot\.js \+ (\d+) modul src\/ \(esbuild, v103\)/],
  ]) {
    assert.ok(re.test(text), `jangkar ${re} hilang dari ${name}`);
  }
  const modul = countModules("src");
  for (const [text, name, re] of [
    [struktur, "STRUKTUR-REPO.md", /# OUTPUT build esbuild: boot\.js \+ (\d+) modul src\//],
    [readme, "README.md", /# OUTPUT BUILD boot\.js \+ (\d+) modul src\/ \(esbuild, v103\)/],
    [petaCepat, "AGENT-HANDOFF.md (Peta cepat)", /bundel esbuild atas `boot\.js` \+ (\d+) modul `src\/\*\*`/],
  ]) {
    const m = text.match(re);
    assert.ok(m, `jangkar ${re} hilang dari ${name}`);
    assert.equal(Number(m[1]), modul, `${name} menyebut ${m[1]} modul src/, kenyataan ${modul}.`);
  }
});

test("dokumen: major versi ESLint = devDependencies package.json", () => {
  const pkg = JSON.parse(read("package.json"));
  const raw = (pkg.devDependencies || {}).eslint || "";
  const major = raw.replace(/^[^0-9]*/, "").split(".")[0];
  assert.ok(major, `versi eslint tidak terbaca dari package.json ("${raw}")`);
  const m = struktur.match(/ESLint (\d+) flat-config/);
  assert.ok(m, "jangkar 'ESLint N flat-config' hilang dari STRUKTUR-REPO.md");
  assert.equal(m[1], major, `STRUKTUR-REPO menulis ESLint ${m[1]}, package.json memakai "${raw}".`);
});

test("dokumen: onclick= tidak lagi disebut sebagai jalur aktif", () => {
  // Tanpa guard ini kalimat "200+ atribut onclick=" (kenyataannya 0 sejak v101-v102)
  // bisa balik lagi tanpa satu pun test merah.
  const handler = /\son(?:click|change|input|submit|keydown|keyup|keypress|focus|blur|load|error|mouse\w+)\s*=/gi;
  const inline = (read("index.html").match(handler) || []).length;
  const konteksOk = /sudah habis|habis dihapus|[Jj]angan|TANPA|0 atribut|dihapus|diganti/i;

  for (const [name, text] of [["README.md", readme], ["STRUKTUR-REPO.md", struktur]]) {
    // (1) Tiap ANGKA yang menempel pada "atribut on...=" wajib = kenyataan (kini 0).
    for (const m of text.matchAll(/(\d+)\+?\s+atribut\s+`{0,2}on\w+=?`{0,2}/gi)) {
      assert.equal(Number(m[1]), inline,
        `${name} menulis "${m[0].trim()}" padahal index.html punya ${inline} atribut handler inline.`);
    }
    // (2) Tiap penyebutan "onclick" wajib berdiri dalam konteks larangan/historis.
    for (const m of text.matchAll(/onclick/gi)) {
      const jendela = text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " ");
      assert.ok(konteksOk.test(jendela),
        `${name} menyebut onclick= tanpa konteks "sudah dihapus / jangan dipakai": ...${jendela}...\n` +
        `  Kenyataan: index.html punya ${inline} atribut handler inline (data-action + registry sejak v101-v102).`);
    }
  }
});

test("dokumen: batas ukuran upload gambar di README = konstanta di app.src.js", () => {
  const app = read("app.src.js");
  const ada = (mb) => new RegExp(`file\\.size > ${mb} \\* 1024 \\* 1024`).test(app);
  assert.ok(ada(8), "guard 8MB (ikon akun & foto profil) hilang dari app.src.js -- batasnya berubah? perbarui README + guard ini.");
  assert.ok(ada(10), "guard 10MB (foto struk utk AI) hilang dari app.src.js -- batasnya berubah? perbarui README + guard ini.");

  const mentah = readme.match(/File mentah yang boleh dipilih dibatasi maks (\d+)MB/);
  assert.ok(mentah, "jangkar 'File mentah yang boleh dipilih dibatasi maks NMB' hilang dari README.md §9");
  assert.equal(Number(mentah[1]), 8, `README menyebut ${mentah[1]}MB, app.src.js memakai 8MB utk ikon/foto profil.`);

  const struk = readme.match(/Khusus foto struk untuk AI batasnya (\d+)MB mentah/);
  assert.ok(struk, "jangkar 'Khusus foto struk untuk AI batasnya NMB mentah' hilang dari README.md §9");
  assert.equal(Number(struk[1]), 10, `README menyebut ${struk[1]}MB utk foto struk, app.src.js memakai 10MB.`);
});

test("struktur: status wiring src/bootstrap/ + auth/lifecycle.js cocok dengan dokumen", () => {
  const boot = read("boot.js");
  const bundle = read("boot.bundle.js");
  const terWire =
    /from\s+["'][^"']*bootstrap\/(app|loader)\.js/.test(boot) ||
    /createAppBootstrap|createBootstrapLoader/.test(bundle) ||
    /createAuthLifecycle/.test(bundle);

  const docMenandai = struktur.includes("BELUM ter-wire ke produksi");

  if (terWire) {
    assert.ok(!docMenandai,
      "src/bootstrap/ (atau auth/lifecycle.js) kini TER-WIRE ke produksi, tapi STRUKTUR-REPO.md masih " +
      "menandainya '⚠️ BELUM ter-wire ke produksi'. Perbarui §2 tree + §3 alur muat, lalu sesuaikan guard ini.");
  } else {
    assert.ok(docMenandai,
      "src/bootstrap/ + src/auth/lifecycle.js TIDAK di-import boot.js dan di-tree-shake habis dari " +
      "boot.bundle.js, tapi STRUKTUR-REPO.md tidak menandainya. Tanpa tanda itu kontributor akan " +
      "mengedit file yang salah: jalur boot produksi adalah IIFE bootstrapAuth() di app.src.js.");
  }

  assert.ok(/\(async function bootstrapAuth\(\) \{/.test(read("app.src.js")),
    "IIFE (async function bootstrapAuth() { ... }) hilang dari app.src.js -- jalur boot produksi berubah? perbarui §3 + guard ini.");
  assert.ok(/IIFE `bootstrapAuth\(\)` di `app\.src\.js`/.test(struktur),
    "jangkar 'IIFE `bootstrapAuth()` di `app.src.js`' hilang dari STRUKTUR-REPO.md §3.");
});

test("dokumen: jumlah guard di berkas ini = klaim STRUKTUR-REPO §5", () => {
  // Guard paling meta: berkas ini menagih jumlah test-nya sendiri, supaya klaim
  // "(N test)" di STRUKTUR-REPO §5 butir 9 tidak ikut basi tiap guard baru ditambah.
  const self = read("tests/unit/docs-consistency.test.js");
  const jumlah = (self.match(/^test\(/gm) || []).length;
  assert.ok(jumlah > 10, `hanya ${jumlah} test terdeteksi di berkas ini -- parser guard ini rusak?`);
  const m = struktur.match(/`tests\/unit\/docs-consistency\.test\.js` \((\d+) test\)/);
  assert.ok(m, "jangkar '`tests/unit/docs-consistency.test.js` (N test)' hilang dari STRUKTUR-REPO.md §5 butir 9");
  assert.equal(Number(m[1]), jumlah,
    `STRUKTUR-REPO §5 menyebut ${m[1]} test di docs-consistency.test.js, kenyataan ${jumlah}.`);
});
