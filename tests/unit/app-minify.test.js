// PENGUJIAN DRIFT app.js (pola sama seperti styles-minify.test.js & sw-cache):
// app.js harus selalu SAMA dengan hasil `npm run build:app` (terser) dari
// app.src.js. Ditambah KONTRAK KHUSUS: seluruh nama handler yang dipanggil
// dari atribut onclick=/onchange=/oninput= (di index.html ATAU di template
// HTML app.src.js) wajib tetap ada sebagai deklarasi fungsi global di app.js
// -- kalau terser pernah menghilangkan/mengganti salah satunya, ini GAGAL
// sebelum masalahnya sampai ke browser.
//
// CATATAN job CI "unit" berjalan TANPA npm ci (hanya Node builtin) -- saat
// terser tidak terpasang, test drift di-SKIP dengan pesan jelas; pengawasan
// drift SESUNGGUHNYA dijaga job css-drift di CI (yang memang npm ci lalu
// npm run build:app + git diff --exit-code -- app.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const SRC = resolve(ROOT, "app.src.js");
const OUT = resolve(ROOT, "app.js");

let terserMinify = null;
try {
  terserMinify = (await import("terser")).minify;
} catch {
  terserMinify = null;
}

async function buildViaScriptConfig() {
  const source = readFileSync(SRC, "utf8");
  const result = await terserMinify(source, {
    ecma: 2020,
    compress: { passes: 2, unsafe: false },
    mangle: { toplevel: false, keep_fnames: true },
    format: { comments: false },
  });
  assert.ok(result.code, "terser tidak menghasilkan kode");
  const bannerBlock = readFileSync(resolve(ROOT, "scripts/build-app.mjs"), "utf8").match(/const BANNER =\s*([\s\S]*?);\n/);
  assert.ok(bannerBlock, "banner build script tidak ketemu");
  const bannerText = [...bannerBlock[1].matchAll(/"([^"]*)"/g)]
    .map((m) => m[1])
    .join("")
    .replace(/\\n/g, "\n");
  return bannerText + result.code;
}

// ---- ekstrak nama handler global dari index.html & app.src.js ----
// Hanya nama yang DIKUTI '(' (pemanggilan fungsi): `onclick="if(...)"`,
// `document.getElementById(...)`, `setTimeout(...)`, `${...}` (template
// literal) TIDAK ikut -- nama seperti itu memang bukan fungsi milik app.
// Nama pemanggil lalu difilter: WAJIB punya deklarasi di app.src.js, karena
// yang kita janjikan adalah "fungsi MILIK APP yang dipanggil dari atribut
// event tetap ada di hasil build" (bukan built-in JS/DOM).
function declaredFunctionRe(name) {
  // `$` di dalam pola regex adalah anchor akhir-string -- escape dulu.
  const n = name.replace(/\$/g, "\\$");
  return new RegExp(
    `function\\s+${n}\\s*\\(|${n}\\s*=\\s*(?:async\\s*)?(?:function|\\()`
  );
}

function appHandlerNames() {
  const srcText = readFileSync(resolve(ROOT, "app.src.js"), "utf8");
  const names = new Set();
  const re =
    /(?:onclick|onchange|oninput|onsubmit|onblur|onfocus|onkeydown|onkeyup)="\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (const file of ["index.html", "app.src.js"]) {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    let m;
    while ((m = re.exec(text)) !== null) {
      if (declaredFunctionRe(m[1]).test(srcText)) names.add(m[1]);
    }
  }
  return [...names];
}

test("app.js: diawali banner /*! (tanda build output); app.src.js lebih besar (sumber utuh)", () => {
  const out = readFileSync(OUT, "utf8");
  const src = readFileSync(SRC, "utf8");
  assert.ok(out.startsWith("/*!"), "app.js harus dimulai dengan banner /*! (build output)");
  assert.ok(out.length < src.length * 0.75, `app.js (${out.length}) harus jauh lebih kecil dari app.src.js (${src.length})`);
  assert.ok(/SUMBER MANUAL app\.js/.test(src), "app.src.js harus memuat header sumber");
});

test("app.js: seluruh handler fungsional tetap ada sebagai deklarasi di hasil build", () => {
  const out = readFileSync(OUT, "utf8");
  const names = appHandlerNames();
  assert.ok(names.length > 10, `handler terdeteksi: ${names.length} (curiga regex rusak)`);
  const missing = names.filter((n) => !declaredFunctionRe(n).test(out));
  assert.deepEqual(
    missing,
    [],
    `Handler berikut HILANG dari app.js (terser mungkin mengubahnya): ${missing.join(", ")}`
  );
});

test(
  "app.js = hasil minify app.src.js (drift guard, pola build script)",
  { skip: terserMinify ? false : "terser tidak terpasang (job CI 'unit' memang tanpa install) -- drift dijaga job css-drift" },
  async () => {
    const committed = readFileSync(OUT, "utf8");
    const built = await buildViaScriptConfig();
    assert.equal(
      committed,
      built,
      "app.js tidak sinkron dengan app.src.js. Jalankan: npm run build:app, lalu commit app.js + app.src.js."
    );
  }
);
