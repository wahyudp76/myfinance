/**
 * v108: deklarasi runtime harus mencerminkan toolchain yang benar-benar
 * dipasang CI. Batas atas <23 sebelumnya membuat Node 23+ ditolak tanpa alasan
 * yang diuji repo, sementara batas bawah >=22 terlalu longgar untuk Lighthouse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const readJson = (rel) => JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
const pkg = readJson("package.json");
const lock = readJson("package-lock.json");

const EXPECTED_NODE_ENGINE = ">=22.19.0";

test("toolchain: package.json mengiklankan Node minimal yang dibutuhkan Lighthouse", () => {
    assert.equal(pkg.engines?.node, EXPECTED_NODE_ENGINE);
    assert.doesNotMatch(pkg.engines.node, /</, "jangan pasang batas atas Node tanpa bukti kompatibilitas");
});

test("toolchain: package-lock root sinkron dengan package.json", () => {
    assert.equal(lock.packages?.[""].engines?.node, pkg.engines.node);
});

test("toolchain: .nvmrc tetap memilih jalur Node 22 LTS", () => {
    assert.equal(readFileSync(resolve(ROOT, ".nvmrc"), "utf8").trim(), "22");
});
