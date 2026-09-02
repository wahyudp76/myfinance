/**
 * Gerbang subset Font Awesome (v51).
 *
 * Sejak v51, css/fontawesome-all.min.css + webfonts/*.woff2 di-SUBSET ke ikon
 * yang benar-benar dipakai (lihat scripts/subset-fontawesome.py). Hemat ~233 KB
 * di jalur kritis, tapi memunculkan satu mode kegagalan baru yang SUNYI:
 *
 *     tambah <i class="fas fa-rocket"> di index.html
 *     -> lupa jalankan ulang scripts/subset-fontawesome.py
 *     -> tidak ada error di mana pun, ikon cuma tampil sebagai kotak kosong
 *        di produksi.
 *
 * Test ini membuat kegagalan itu jadi BERISIK: setiap nama ikon yang dipakai
 * kode wajib punya rule content di CSS yang ter-commit.
 *
 * Kalau test ini merah, perbaikannya:
 *     python3 scripts/subset-fontawesome.py
 *     node tests/unit/update-sw-cache-snapshot.mjs   (aset berubah)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;

// Harus cocok dengan NON_ICON di scripts/subset-fontawesome.py.
const NON_ICON = new Set([
  "fa", "fas", "far", "fab", "fal", "fad", "fat",
  "fa-solid", "fa-regular", "fa-brands", "fa-light", "fa-thin", "fa-duotone",
  "fa-fw", "fa-ul", "fa-li", "fa-border", "fa-pull-left", "fa-pull-right",
  "fa-spin", "fa-spin-pulse", "fa-spin-reverse", "fa-pulse", "fa-beat",
  "fa-fade", "fa-beat-fade", "fa-bounce", "fa-shake", "fa-flip",
  "fa-flip-horizontal", "fa-flip-vertical", "fa-flip-both",
  "fa-rotate-90", "fa-rotate-180", "fa-rotate-270", "fa-rotate-by",
  "fa-inverse", "fa-stack", "fa-stack-1x", "fa-stack-2x",
  "fa-1x", "fa-2x", "fa-3x", "fa-4x", "fa-5x", "fa-6x", "fa-7x", "fa-8x",
  "fa-9x", "fa-10x", "fa-2xs", "fa-xs", "fa-sm", "fa-lg", "fa-xl", "fa-2xl",
  "fa-sr-only", "fa-sr-only-focusable", "fa-swap-opacity", "fa-layers",
]);

// Token yang bukan ikon: potongan nama yang dirakit runtime + nama file font.
const IGNORE = new Set(["fa-arrow", "fa-brands-400", "fa-solid-900"]);

function collectFiles() {
  const out = ["index.html", "styles.css", "sw.js"].map((f) => join(ROOT, f));
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === "_full") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs|ts|html|css)$/.test(name)) out.push(full);
    }
  };
  ["src", "scripts", "supabase"].forEach((d) => walk(join(ROOT, d)));
  // v54: index.html & app.js (blok monolit yang dipindah) -- sumber ikon utama app.
  ["index.html", "app.js"].forEach((f) => {
    const p = join(ROOT, f);
    if (existsSync(p)) out.push(p);
  });
  return out;
}

function usedIcons() {
  const used = new Set();
  for (const file of collectFiles()) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const tok of text.match(/fa-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
      if (!NON_ICON.has(tok) && !IGNORE.has(tok)) used.add(tok);
    }
  }
  return used;
}

function iconsWithRule(cssText) {
  const names = new Set();
  const re = /((?:\.fa-[a-z0-9-]+(?:::?before)?\s*,\s*)*\.fa-[a-z0-9-]+(?:::?before)?)\{content:"\\[0-9a-f]+"\}/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    for (const n of m[1].match(/\.(fa-[a-z0-9-]+)/g) ?? []) names.add(n.slice(1));
  }
  return names;
}

test("setiap ikon Font Awesome yang dipakai punya rule di CSS subset", () => {
  const css = readFileSync(join(ROOT, "css/fontawesome-all.min.css"), "utf8");
  const full = readFileSync(join(ROOT, "css/_full/fontawesome-all.min.css"), "utf8");
  const shipped = iconsWithRule(css);
  const available = iconsWithRule(full);

  const missing = [];
  const notInFontAwesome = [];
  for (const icon of usedIcons()) {
    if (!available.has(icon)) {
      // Dipakai di kode tapi tidak ada di Font Awesome Free sama sekali
      // (biasanya ikon Pro atau salah ketik) -- itu bug tersendiri.
      notInFontAwesome.push(icon);
    } else if (!shipped.has(icon)) {
      missing.push(icon);
    }
  }

  assert.deepEqual(
    notInFontAwesome,
    [],
    `Ikon ini tidak ada di Font Awesome Free (ikon Pro atau typo) sehingga akan tampil kosong: ${notInFontAwesome.join(", ")}`,
  );
  assert.deepEqual(
    missing,
    [],
    `Ikon ini dipakai tapi terbuang dari subset -- jalankan: python3 scripts/subset-fontawesome.py (lalu update snapshot SW). Ikon: ${missing.join(", ")}`,
  );
});

test("subset benar-benar membuang mayoritas ikon (kalau tidak, subset gagal jalan)", () => {
  const css = readFileSync(join(ROOT, "css/fontawesome-all.min.css"), "utf8");
  const full = readFileSync(join(ROOT, "css/_full/fontawesome-all.min.css"), "utf8");
  const shipped = iconsWithRule(css).size;
  const available = iconsWithRule(full).size;
  assert.ok(available > 1000, `CSS cadangan tampak bukan Font Awesome penuh (${available} ikon)`);
  assert.ok(
    shipped < available / 2,
    `CSS yang dikirim masih memuat ${shipped} dari ${available} ikon -- subset sepertinya tidak diterapkan.`,
  );
});
