// v109: setelah semua atribut style dipindah ke CSS/CSSOM, style-src tidak
// lagi membutuhkan unsafe-inline. Guard sengaja menyisir sumber + artefak build:
// mengedit app.src.js/src/ lalu lupa build tidak boleh menghidupkan regresi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

function jsSources(dir) {
    return readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return jsSources(rel);
        return entry.name.endsWith(".js") ? [rel] : [];
    });
}

const productionFiles = ["index.html", "app.src.js", "app.js", "boot.js", "boot.bundle.js", ...jsSources("src")];
const inlineStylePattern = /style\s*=\s*["']/i;
// FullCalendar 6.1.10 membuat satu <style data-fullcalendar> kosong lalu
// mengisinya melalui CSSOM insertRule(). Hash ini mengizinkan elemen kosong itu
// tanpa membuka unsafe-inline; style-src-attr 'none' tetap memblokir atribut.
const FULLCALENDAR_EMPTY_STYLE_HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

function styleSrc(policy) {
    return policy.match(/(?:^|;)\s*style-src\s+([^;]*)/)?.[1] || "";
}

test("CSP style: style-src tidak lagi mengizinkan unsafe-inline", () => {
    const html = read("index.html");
    const headers = read("_headers");
    const meta = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/)?.[1] || "";
    const header = headers.match(/^\s*Content-Security-Policy:\s*(.*)$/m)?.[1] || "";
    for (const [name, policy] of [["meta", meta], ["_headers", header]]) {
        assert.ok(policy, `CSP ${name} tidak terbaca`);
        assert.doesNotMatch(styleSrc(policy), /'unsafe-inline'/, `${name} masih membuka style inline`);
        assert.ok(styleSrc(policy).includes(FULLCALENDAR_EMPTY_STYLE_HASH),
            `${name} harus mengizinkan <style> kosong yang dipakai FullCalendar via CSSOM`);
        assert.match(policy, /style-src-attr\s+'none'/, `${name} harus menutup style-src-attr secara eksplisit`);
    }
});

test("CSP style: sumber dan artefak produksi tidak memiliki atribut style=", () => {
    const offenders = productionFiles.filter((file) => inlineStylePattern.test(read(file)));
    assert.deepEqual(offenders, [], `Atribut style= tersisa di: ${offenders.join(", ")}`);
});
