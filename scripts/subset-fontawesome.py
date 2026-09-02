#!/usr/bin/env python3
"""
Subset Font Awesome ke ikon yang BENAR-BENAR dipakai aplikasi (v51).

Kenapa ada skrip ini
--------------------
Font Awesome versi penuh yang di-vendor di repo ini berat sekali untuk aset
yang cuma dipakai sebagian kecil:

    css/fontawesome-all.min.css   ~100 KB  (ribuan rule .fa-*:before)
    webfonts/fa-solid-900.woff2   ~150 KB  (ribuan glyph)
    webfonts/fa-brands-400.woff2  ~108 KB  (ribuan glyph)

woff2 SUDAH terkompresi, jadi gzip GitHub Pages tidak menolong sama sekali di
sana -- 150 KB itu benar-benar 150 KB di kabel, dan itu jauh lebih mahal
daripada dokumen HTML 640 KB yang menyusut jadi ~144 KB setelah gzip.
Aplikasi ini cuma memakai ~200 ikon.

Strategi (sengaja konservatif)
------------------------------
1. Scan seluruh sumber untuk token `fa-...`. Ini menangkap markup statis DAN
   daftar ikon yang dipakai icon-picker (semuanya array hardcoded di
   index.html, tidak ada input nama ikon berbentuk teks bebas -- sudah
   diverifikasi sebelum skrip ini ditulis; kalau suatu hari picker berubah
   jadi input bebas, subset ini WAJIB dibatalkan).
2. JANGAN tulis ulang CSS Font Awesome dari nol. Kita hanya MEMBUANG rule
   `.fa-nama:before{content:"\\fxxx"}` milik ikon yang tidak dipakai, dan
   membiarkan seluruh sisanya (@font-face, .fa, .fa-spin, .fa-fw, .fa-2x,
   keyframes, dst.) apa adanya. Utility class tidak mungkin ikut hilang.
3. Subset woff2 lewat fonttools ke himpunan codepoint yang tersisa.

Menjalankan:  python3 scripts/subset-fontawesome.py
Butuh:        pip install fonttools brotli

Output ditulis ke css/fontawesome-all.min.css dan webfonts/*.woff2 (menimpa),
jadi sumber aslinya disimpan di webfonts/_full/ + css/_full/ sebagai cadangan
supaya subset bisa dibangun ulang kalau daftar ikon bertambah.
"""
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CSS = os.path.join(ROOT, "css", "fontawesome-all.min.css")
CSS_FULL = os.path.join(ROOT, "css", "_full", "fontawesome-all.min.css")
WEBFONTS = os.path.join(ROOT, "webfonts")
WEBFONTS_FULL = os.path.join(WEBFONTS, "_full")

# File yang di-scan untuk mencari nama ikon.
SCAN_FILES = []
# v54: blok script monolit dipindah dari index.html ke app.js -- keduanya
# di-scan supaya ikon yang dipakai app tidak pernah "hilang" dari subset.
for rel in ["index.html", "app.js", "styles.css", "sw.js"]:
    SCAN_FILES.append(os.path.join(ROOT, rel))
for sub in ["src", "scripts", "supabase"]:
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, sub)):
        dirnames[:] = [d for d in dirnames if d not in {"node_modules", "_full"}]
        for fn in filenames:
            if fn.endswith((".js", ".mjs", ".ts", ".html", ".css")):
                SCAN_FILES.append(os.path.join(dirpath, fn))

# Class Font Awesome yang BUKAN nama ikon (utility/modifier). Rule-nya tidak
# pernah kita buang -- ini murni supaya laporan "ikon dipakai" tidak bising.
NON_ICON = {
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
}

# SAFELIST -- ikon yang namanya DIRAKIT saat runtime sehingga tidak utuh
# terbaca oleh scanner di atas. Contoh nyata di index.html:
#
#     `<i class="fas fa-arrow-${up ? 'up' : 'down'}">`
#
# scanner hanya melihat token "fa-arrow". Kalau ikon semacam ini tidak
# didaftarkan di sini, glyph-nya ikut terbuang dan UI menampilkan kotak
# kosong -- kegagalan yang sunyi dan baru ketahuan di produksi.
#
# ATURAN: setiap kali menambah nama ikon dinamis di kode, tambahkan SEMUA
# kemungkinan hasilnya ke daftar ini.
SAFELIST = {
    "fa-arrow-up",
    "fa-arrow-down",
}


def restore_originals():
    """Pastikan kita selalu men-subset dari sumber PENUH, bukan dari hasil
    subset sebelumnya (kalau tidak, tiap run akan mengikis ikon terus)."""
    os.makedirs(os.path.dirname(CSS_FULL), exist_ok=True)
    os.makedirs(WEBFONTS_FULL, exist_ok=True)

    if not os.path.exists(CSS_FULL):
        shutil.copy2(CSS, CSS_FULL)
    for fn in os.listdir(WEBFONTS):
        src = os.path.join(WEBFONTS, fn)
        if os.path.isfile(src) and fn.endswith(".woff2"):
            dst = os.path.join(WEBFONTS_FULL, fn)
            if not os.path.exists(dst):
                shutil.copy2(src, dst)


def collect_used():
    used = set()
    for path in SCAN_FILES:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                text = fh.read()
        except OSError:
            continue
        for tok in re.findall(r"fa-[a-z0-9]+(?:-[a-z0-9]+)*", text):
            if tok not in NON_ICON:
                used.add(tok)
    return used | SAFELIST


def parse_icon_rules(css_text):
    """Kembalikan list (selector_names, codepoint, span) untuk tiap rule
    `.fa-x:before{content:"\\fxxx"}` (termasuk rule bergabung berkoma)."""
    rules = []
    pattern = re.compile(
        r"((?:\.fa-[a-z0-9-]+(?:::?before)?\s*,\s*)*\.fa-[a-z0-9-]+(?:::?before)?)"
        r"\{content:\"(\\[0-9a-f]+)\"\}"
    )
    for m in pattern.finditer(css_text):
        sel = m.group(1)
        names = set(re.findall(r"\.(fa-[a-z0-9-]+)", sel))
        cp = int(m.group(2).lstrip("\\"), 16)
        rules.append((names, cp, m.span()))
    return rules


def main():
    restore_originals()

    with open(CSS_FULL, "r", encoding="utf-8") as fh:
        css_text = fh.read()

    used = collect_used()
    rules = parse_icon_rules(css_text)
    if not rules:
        sys.exit("FATAL: tidak ada rule ikon terparse -- format CSS berubah, batalkan subset.")

    keep_cps = set()
    drop_spans = []
    kept_names = set()
    for names, cp, span in rules:
        if names & used:
            keep_cps.add(cp)
            kept_names |= (names & used)
        else:
            drop_spans.append(span)

    # Buang rule dari belakang supaya offset tetap valid.
    out = css_text
    for start, end in sorted(drop_spans, reverse=True):
        out = out[:start] + out[end:]
    out = re.sub(r";{2,}", ";", out)

    with open(CSS, "w", encoding="utf-8") as fh:
        fh.write(out)

    # Ikon yang disebut di kode tapi tidak ada di CSS -> kemungkinan typo atau
    # nama alias FA5 yang sudah hilang. Dilaporkan, tidak menggagalkan build.
    all_css_names = set()
    for names, _cp, _span in rules:
        all_css_names |= names
    unknown = sorted(n for n in used if n not in all_css_names)

    print(f"ikon dipakai (token unik) : {len(used)}")
    print(f"ikon cocok di CSS         : {len(kept_names)}")
    print(f"codepoint dipertahankan   : {len(keep_cps)}")
    print(f"rule ikon dibuang         : {len(drop_spans)}")
    print(f"CSS  {os.path.getsize(CSS_FULL)/1024:7.1f} KB -> {os.path.getsize(CSS)/1024:7.1f} KB")
    if unknown:
        print(f"CATATAN: {len(unknown)} token fa-* tidak ada di CSS (utility/typo/alias): {', '.join(unknown[:12])}")

    unicodes = ",".join(f"U+{cp:04X}" for cp in sorted(keep_cps))
    for fn in sorted(os.listdir(WEBFONTS_FULL)):
        if not fn.endswith(".woff2"):
            continue
        src = os.path.join(WEBFONTS_FULL, fn)
        dst = os.path.join(WEBFONTS, fn)
        before = os.path.getsize(src)
        subprocess.run(
            [sys.executable, "-m", "fontTools.subset", src,
             f"--unicodes={unicodes}",
             "--flavor=woff2",
             "--layout-features=",
             "--no-hinting",
             "--desubroutinize",
             f"--output-file={dst}"],
            check=True,
        )
        after = os.path.getsize(dst)
        print(f"{fn:24s} {before/1024:7.1f} KB -> {after/1024:7.1f} KB  ({100 - after * 100 // before}% lebih kecil)")


if __name__ == "__main__":
    main()
