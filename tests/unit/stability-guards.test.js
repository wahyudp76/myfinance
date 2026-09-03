// GUARD REGRESI v69 (perawatan stabilitas) -- guard statis di app.src.js.
// Latar: loadData() (sinkronisasi 6 tabel) sebelumnya TANPA generation guard:
//   - Respons fetch yang BASI (pull-to-refresh tumpang-tindih, atau fetch yang
//     selesai SETELAH logout/ganti akun) tetap menimpa state -> bisa memicu
//     toast error palsu & mencemari state sesi/akun baru.
//   - Pembacaan DOM tanpa null-guard di awal loadData: kalau elemen hilang,
//     throw terjadi DI LUAR rantai .then/.catch -> overlay sinkronisasi bisa
//     nyangkut selamanya (async rejection tanpa penangan).
// Perbaikan v69: nomor urut generasi (_loadDataSeq) + id akun di-capture saat
// loadData dipanggil; commit & toast error hanya boleh dari panggilan yang
// masih terakhir & akun sama. resetAppState() membatalkan semua in-flight
// (bump _loadDataSeq). Konsisten dgn kontrak docs/production-loader-contract.md.
//
// Kalau salah satu invariant di bawah hilang, test ini MERAH di CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const src = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

function sliceBetween(a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + 1);
  if (i === -1 || j === -1) return null;
  return src.slice(i, j);
}

test("v69: loadData menangkap generasi & id akun saat dipanggil", () => {
  const loadDataHead = sliceBetween("async function loadData() {", "const syncFetch = (async () => {");
  assert.ok(loadDataHead, "tubuh loadData harus ada");
  assert.ok(
    loadDataHead.includes("const loadSeq = ++_loadDataSeq;"),
    "loadData harus menangkap nomor urut generasi (_loadDataSeq) di awal"
  );
  assert.ok(
    loadDataHead.includes("const loadUserId = (currentSession"),
    "loadData harus menangkap id akun yang sedang aktif (untuk guard logout/ganti akun)"
  );
});

test("v69: commit state hanya dari panggilan yang masih terakhir & akun sama", () => {
  const chain = sliceBetween("syncFetch.then((response) => {", "}).catch((err) => {");
  assert.ok(chain, "rantai syncFetch.then harus ada");
  assert.ok(
    chain.includes("const stillCurrent = loadSeq === _loadDataSeq"),
    "guard commit harus membandingkan generasi panggilan dgn generasi terakhir"
  );
  assert.ok(
    chain.includes("currentSession.user.id === loadUserId"),
    "guard commit harus memastikan akun tidak berubah selama fetch (logout/ganti akun)"
  );
  assert.ok(
    chain.includes("if (!stillCurrent) return;"),
    "commit basi harus dilewati (return sebelum menimpa state)"
  );
});

test("v69: error dari panggilan basi tidak menampilkan toast", () => {
  const catchBlock = sliceBetween("}).catch((err) => {", "setSyncLoading(false);\n            });");
  assert.ok(catchBlock, "blok .catch loadData harus ada");
  assert.ok(
    catchBlock.includes("if (loadSeq !== _loadDataSeq) return;"),
    ".catch harus melewati panggilan basi (tanpa toast/status error)"
  );
});

test("v69: resetAppState membatalkan sinkronisasi yang masih berjalan", () => {
  const reset = sliceBetween("function resetAppState() {", "function initStaticUIListeners() {");
  assert.ok(reset, "resetAppState harus ada");
  assert.ok(
    reset.includes("_loadDataSeq += 1;"),
    "resetAppState (logout) harus menaikkan generasi supaya fetch in-flight dari sesi lama otomatis basi"
  );
});

test("v69: pembacaan elemen filter bulan di loadData null-safe", () => {
  assert.ok(
    src.includes("const budgetFilterEl = document.getElementById('budgetFilterMonth');"),
    "loadData harus membaca elemen filter bulan lewat variabel perantara"
  );
  assert.ok(
    src.includes("(budgetFilterEl && budgetFilterEl.value) || todayDateStr().slice(0, 7)"),
    "nilai filter bulan harus null-safe (fallback bulan berjalan) supaya tidak ada throw di luar rantai .catch"
  );
});
