import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ============================================================================
// v86 GUARD SINKRONISASI: daftar host gambar remote harus IDENTIK di 3 tempat:
//   1. ICON_REMOTE_HOSTS di src/domain/settings.js (gerbang sanitizer render)
//   2. meta CSP img-src di index.html (gerbang browser, berlaku di GitHub Pages)
//   3. Content-Security-Policy img-src di _headers (berlaku di Netlify/CF Pages)
// Drift antar ketiganya = logo "lolos sanitizer tapi diblokir CSP" (atau
// sebaliknya) -- kelas bug persis yang terjadi selama rangkaian fix logo 2026-09-06.
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SETTINGS_SRC = readFileSync(resolve(ROOT, "src/domain/settings.js"), "utf8");
const INDEX_SRC = readFileSync(resolve(ROOT, "index.html"), "utf8");
const HEADERS_SRC = readFileSync(resolve(ROOT, "_headers"), "utf8");

function hostsFromSettings() {
  const m = SETTINGS_SRC.match(/const ICON_REMOTE_HOSTS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, "ICON_REMOTE_HOSTS tidak ditemukan di src/domain/settings.js");
  return new Set(
    [...m[1].matchAll(/"([^"]+)"/g)].map((h) => h[1]),
  );
}

function hostsFromCsp(csp, label) {
  const m = csp.match(/img-src ([^;]+);/);
  assert.ok(m, `directive img-src tidak ditemukan di ${label}`);
  return new Set(
    m[1].trim().split(/\s+/)
      .filter((tok) => tok.startsWith("https://"))
      .map((tok) => tok.slice("https://".length)),
  );
}

test("CSP img-src (index.html) == ICON_REMOTE_HOSTS (settings.js)", () => {
  const fromCsp = hostsFromCsp(INDEX_SRC, "index.html");
  const fromSettings = hostsFromSettings();
  assert.deepEqual([...fromCsp].sort(), [...fromSettings].sort());
});

test("CSP img-src (_headers) == ICON_REMOTE_HOSTS (settings.js)", () => {
  const fromHeaders = hostsFromCsp(HEADERS_SRC, "_headers");
  const fromSettings = hostsFromSettings();
  assert.deepEqual([...fromHeaders].sort(), [...fromSettings].sort());
});

test("CSP img-src index.html == _headers (tidak boleh drift antar keduanya)", () => {
  const a = hostsFromCsp(INDEX_SRC, "index.html");
  const b = hostsFromCsp(HEADERS_SRC, "_headers");
  assert.deepEqual([...a].sort(), [...b].sort());
});
