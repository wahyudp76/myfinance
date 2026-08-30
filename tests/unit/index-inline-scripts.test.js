// Gerbang sintaks utk blok <script> inline di index.html -- otomatisasi ritual
// manual "comment-mask -> node --check" yang dipakai sepanjang seri refactor
// api-seam. Latar belakang: ~390 ribu karakter JS app hidup inline di monolith
// dan TIDAK dilint/di-check otomatis di mana pun; regresi kelas c57dc6d
// (identifier salah tulis di inline script) hanya tertangkal kalau bloknya
// divalidasi sintaks per commit. Masking komentar HTML dulu supaya regex
// <script> tidak cocok dengan blok yang dikomentarkan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

// Ganti komentar HTML dgn placeholder sepanjang aslinya (posisi baris terjaga).
const masked = html.replace(/<!--[\s\S]*?-->/g, (m) => "\x00".repeat(m.length));

const blocks = [...masked.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .map((m) => ({ attrs: m[1], body: m[2] }))
  .filter((b) => b.attrs.includes("module") || b.body.split("\n").length > 21);

test("index.html memuat blok script app yang diharapkan (module + classic)", () => {
  // Guard ekstraksi: kalau regex/masker sampai rusak karena perubahan HTML,
  // test ini GAGAL loudly (bukan diam-diam nol test) supaya langsung ketahuan.
  assert.ok(blocks.length >= 2, `blok script app terdeteksi: ${blocks.length}, harusnya >= 2`);
  assert.ok(blocks.some((b) => b.attrs.includes("module")), "blok type=module harus ada");
});

for (const [i, block] of blocks.entries()) {
  const kind = block.attrs.includes("module") ? "module" : "classic";
  test(`index.html blok script #${i} (${kind}) lolos node --check`, () => {
    const dir = mkdtempSync(join(tmpdir(), "myfinance-inline-check-"));
    // .mjs utk blok module (di-parse sbg ESM: import/export/TLA legal);
    // .js utk blok classic.
    const file = join(dir, `block${i}.${kind === "module" ? "mjs" : "js"}`);
    writeFileSync(file, block.body);
    try {
      const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(res.status, 0, `Syntax error di blok script ${kind}:\n${res.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
