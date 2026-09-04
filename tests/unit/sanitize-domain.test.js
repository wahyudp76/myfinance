import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { escapeHtml, jsStr, sanitizeCtx } from "../../src/domain/sanitize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// ---------- helper: ekstrak implementasi ASLI dari blok __sanitize di app.src.js ----------
// Sejak v77, implementasi monolit asli dipertahankan sebagai DEFAULT di `__sanitize`
// (objek top-level), dan fungsi global escapeHtml/jsStr menjadi delegasi tipis ke
// __sanitize (meng-adopsi modul ter-tes src/domain/sanitize.js). Guard ini membandingkan
// MODUL terhadap implementasi DEFAULT __sanitize yang tersimpan di app.src.js -- yang
// adalah kebenaran perilaku produksi yang berjalan selama ini.
function extractSanitizeDefault(name) {
  const re = new RegExp(name + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*", "g");
  const m = re.exec(MONOLITH_SRC);
  assert.ok(m, `Default __sanitize.${name} tidak ditemukan di app.src.js -- kontrak berubah?`);
  const bodyStart = MONOLITH_SRC.indexOf("{", m.index + m[0].length - 1);
  let depth = 0, i = bodyStart;
  for (; i < MONOLITH_SRC.length; i++) {
    const ch = MONOLITH_SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  const fnSource = MONOLITH_SRC.slice(m.index, i + 1);
  const fnOnly = fnSource.replace(new RegExp("\\s*^\\s*" + name + "\\s*:\\s*", "m"), "");
  return Function(`"use strict"; return (${fnOnly});`)();
}

const monolithFns = {};
try {
  monolithFns.escapeHtml = extractSanitizeDefault("escapeHtml");
  monolithFns.jsStr = extractSanitizeDefault("jsStr");
} catch (e) {
  monolithFns.extractError = e;
}

// ============================================================================
// PERILAKU
// ============================================================================
test("escapeHtml: escape & pertama (hindari peng-escape-an ganda)", () => {
  // Urutan '&' PERTAMA adalah kontrak; hasilnya harus tunggal, bukan &amp;amp;
  assert.equal(escapeHtml("<p>&"),
    "&lt;p&gt;&amp;");
  assert.equal(escapeHtml("&amp;"), "&amp;amp;");
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("escapeHtml: karakter <, >, \" di-escape; tanpa duplikasi", () => {
  assert.equal(escapeHtml('<a href="x">y</a>'),
    "&lt;a href=&quot;x&quot;&gt;y&lt;/a&gt;");
  assert.equal(escapeHtml('Say "hello" & <bye>'),
    "Say &quot;hello&quot; &amp; &lt;bye&gt;");
  // Karakter aman tidak berubah
  assert.equal(escapeHtml("abc 123 -_/."), "abc 123 -_/.");
});

test("escapeHtml: non-string di-coerce ke String (null/angka/objek)", () => {
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtml(123), "123");
  // null -> "null" (String(null)); undefined -> "undefined" -- konsisten dgn String()
  assert.equal(escapeHtml(null), "null");
  assert.equal(escapeHtml(undefined), "undefined");
  assert.equal(escapeHtml(0), "0");
});

test("jsStr: backslash & kutip tunggal di-loloskan", () => {
  assert.equal(jsStr("a'b"), "a\\'b");
  assert.equal(jsStr("a\\b"), "a\\\\b");
  assert.equal(jsStr("it's a \\ path"), "it\\'s a \\\\ path");
  // kutip ganda & bukan karakter aman tetap utuh
  assert.equal(jsStr('say "hi"'), 'say "hi"');
  assert.equal(jsStr("plain"), "plain");
});

test("sanitizeCtx: menyediakan fungsi escape", () => {
  const c = sanitizeCtx();
  assert.equal(typeof c.escapeHtml, "function");
  assert.equal(typeof c.jsStr, "function");
  assert.equal(c.escapeHtml("<"), "&lt;");
  assert.equal(c.jsStr("'"), "\\'");
});

// ============================================================================
// GUARD KONSISTENSI: modul vs implementasi DEFAULT __sanitize (kebenaran produksi)
// ============================================================================
test("KONSISTENSI: escapeHtml modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = [
    "", "<p>", "a & b", "x<y>z", '"quoted"', "&amp;", "héllo ~", "<script>alert(1)</script>",
    null, undefined, 0, 123, true, { a: 1 },
  ];
  for (const v of cases) {
    assert.equal(escapeHtml(v), monolithFns.escapeHtml(v), `escapeHtml(${String(v)})`);
  }
});

test("KONSISTENSI: jsStr modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = ["", "a'b", 'a"b', "a\\b", "plain", "it's a \\ path", null, undefined, 5, true];
  for (const v of cases) {
    assert.equal(jsStr(v), monolithFns.jsStr(v), `jsStr(${String(v)})`);
  }
});

// ============================================================================
// WIRING: pastikan monolit benar2 mengadopsi modul via __sanitize + delegator global
// ============================================================================
test("WIRING: app.src.js punya __sanitize + adoptSanitizeModule + delegasi ke modul", () => {
  assert.match(MONOLITH_SRC, /let __sanitize\s*=/);
  assert.match(MONOLITH_SRC, /adoptSanitizeModule\s*\(/);
  assert.match(MONOLITH_SRC, /typeof servicesModule\.sanitizeCtx\s*===\s*["']function["']/);
  assert.match(MONOLITH_SRC, /__sanitize\s*=\s*servicesModule\.sanitizeCtx\(\)/);
  // fungsi global yang DELEGASI (memanggil __sanitize.<name>), bukan menghitung sendiri.
  for (const n of ["escapeHtml", "jsStr"]) {
    const fnSrc = (MONOLITH_SRC.match(new RegExp("function\\s+" + n + "\\s*\\([^)]*\\)\\s*\\{([^}]*)\\}")) || [])[1] || "";
    assert.match(fnSrc, new RegExp("__sanitize\\." + n), `delegasi __sanitize.${n} tidak ditemukan di app.src.js`);
  }
});

test("WIRING: index.html mengimpor sanitizeCtx & memaparkannya di __myfinanceServices", () => {
  const HTML_SRC = readFileSync(resolve(ROOT, "index.html"), "utf8");
  assert.match(HTML_SRC, /import\s+\{[^}]*sanitizeCtx[^}]*\}\s+from\s+['"].*\bsrc\/domain\/sanitize\.js/);
  assert.match(HTML_SRC, /sanitizeCtx,/);
  // servicesModule.sanitizeCtx harus dipanggil oleh adopt (dicek di atas), dan
  // modul memaparkan fungsi yang sama.
  const svc = sanitizeCtx();
  assert.equal(svc.escapeHtml("<"), "&lt;");
});
