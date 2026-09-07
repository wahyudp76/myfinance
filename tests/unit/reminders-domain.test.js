/**
 * Unit test src/domain/reminders.js (v92 / Fase 1B — Notifikasi & Pengingat).
 * Fokus: idempotensi id per periode+ambang, batas ambang (79.9/80/99.9/100),
 * H-1 recurring, H-7/H-1 goals, penanggalan lintas bulan/tahun, dedup log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    REMINDER_PREFS_DEFAULTS, normalizeReminderPrefs,
    computeDueReminders, filterUnsent, mergeSentLog,
} from '../../src/domain/reminders.js';

const TODAY = '2026-09-15';
const fmt = (n) => 'Rp' + n; // sengaja beda biar kelihatan disuntik

function baseCtx(over) {
    return Object.assign({ transactions: [], budgets: {}, goals: [], recurring: [], todayStr: TODAY, formatRp: fmt }, over);
}

// ---------------------------------------------------------------------------
// Pengingat budget
// ---------------------------------------------------------------------------
test('budget: 80% dan 100% adalah dua pengingat berbeda pada bulan sama', () => {
    const r80 = computeDueReminders(baseCtx({ budgets: { Makanan: 100000 }, transactions: [{ jenis: 'Pengeluaran', kategori: 'Makanan', jumlah: 80000, tanggal: TODAY }] }));
    assert.equal(r80.length, 1);
    assert.equal(r80[0].id, 'budget:2026-09:80:Makanan');
    assert.equal(r80[0].kind, 'budget-warning');
    assert.ok(r80[0].body.includes('Rp20000')); // sisa via formatRp suntikan

    const r100 = computeDueReminders(baseCtx({ budgets: { Makanan: 100000 }, transactions: [{ jenis: 'Pengeluaran', kategori: 'Makanan', jumlah: 100001, tanggal: TODAY }] }));
    assert.equal(r100.length, 1);
    assert.equal(r100[0].id, 'budget:2026-09:100:Makanan');
    assert.equal(r100[0].kind, 'budget-over');
});

test('budget: hanya pengeluaran bulan berjalan yang dihitung', () => {
    const rs = computeDueReminders(baseCtx({
        budgets: { Makanan: 100000 },
        transactions: [
            { jenis: 'Pengeluaran', kategori: 'Makanan', jumlah: 90000, tanggal: '2026-08-20' }, // bulan lalu: tak dihitung
            { jenis: 'Pengeluaran', kategori: 'Makanan', jumlah: 20000, tanggal: '2026-09-01' }, // awal bulan ini
            { jenis: 'Pemasukan', kategori: 'Makanan', jumlah: 90000, tanggal: TODAY }, // bukan pengeluaran
        ],
    }));
    assert.equal(rs.length, 0); // 20000/100000 = 20% -> tidak ada
});

test('budget: 79.99% tidak memicu; jumlah negatif (pemasukan salah jenis) tidak mengacaukan', () => {
    const rs = computeDueReminders(baseCtx({
        budgets: { Transport: 100000 },
        transactions: [{ jenis: 'Pengeluaran', kategori: 'Transport', jumlah: 79999, tanggal: TODAY }],
    }));
    assert.equal(rs.length, 0);
});

test('budget: kategori tanpa budget / budget 0 diabaikan; prefs.budget=false mematikan', () => {
    assert.equal(computeDueReminders(baseCtx({ budgets: { X: 0 }, transactions: [{ jenis: 'Pengeluaran', kategori: 'X', jumlah: 500, tanggal: TODAY }] })).length, 0);
    const off = computeDueReminders(baseCtx({ budgets: { Makanan: 100000 }, transactions: [{ jenis: 'Pengeluaran', kategori: 'Makanan', jumlah: 150000, tanggal: TODAY }] }), { budget: false });
    assert.equal(off.length, 0);
});

// ---------------------------------------------------------------------------
// Pengingat tujuan keuangan
// ---------------------------------------------------------------------------
test('goals: H-7 dan H-1 terpicu; tercapai/tanpa deadline/di luar ambang tidak', () => {
    const rs = computeDueReminders(baseCtx({
        goals: [
            { id: 'g1', nama: 'Dana Darurat', target: 10000000, terkumpul: 4000000, deadline: '2026-09-22' }, // H-7
            { id: 'g2', nama: 'Laptop', target: 1000000, terkumpul: 1000000, deadline: '2026-09-16' }, // tercapai -> skip
            { id: 'g3', nama: 'DP Rumah', target: 50000000, terkumpul: 1000, deadline: '2027-01-01' }, // jauh -> skip
            { id: 'g4', nama: 'Gadget', target: 2000000, terkumpul: 100, deadline: '2026-09-16' }, // H-1
        ],
    }));
    assert.equal(rs.length, 2);
    assert.ok(rs.some((r) => r.id === 'goal:g1:2026-09-22:H7'));
    assert.ok(rs.some((r) => r.id === 'goal:g4:2026-09-16:H1'));
});

test('goals: deadline hari ini / kemarin tidak dibuat pengingat (sudah lewat, bukan H-)', () => {
    const rs = computeDueReminders(baseCtx({
        goals: [
            { id: 'gx', nama: 'Telat', target: 100, terkumpul: 1, deadline: TODAY },
            { id: 'gy', nama: 'Lebih telat', target: 100, terkumpul: 1, deadline: '2026-09-14' },
        ],
    }));
    assert.equal(rs.length, 0);
});

// ---------------------------------------------------------------------------
// Pengingat transaksi berulang
// ---------------------------------------------------------------------------
test('recurring: hanya yang aktif dan jatuh tempo BESOK', () => {
    const rs = computeDueReminders(baseCtx({
        recurring: [
            { id: 'r1', active: true, next_due_date: '2026-09-16', frequency: 'bulanan', jenis: 'Pengeluaran', kategori: 'Listrik', jumlah: 350000, keterangan: 'Token listrik' },
            { id: 'r2', active: true, next_due_date: TODAY, kategori: 'X', jumlah: 1 }, // hari ini -> bukan H-1
            { id: 'r3', active: false, next_due_date: '2026-09-16', kategori: 'X', jumlah: 1 }, // dijeda
            { id: 'r4', active: true, next_due_date: '2026-09-18', kategori: 'X', jumlah: 1 }, // 3 hari lagi
        ],
    }));
    assert.equal(rs.length, 1);
    assert.equal(rs[0].id, 'recurring:r1:2026-09-16');
    assert.ok(rs[0].title.includes('Token listrik'));
    assert.ok(rs[0].body.includes('Rp350000'));
});

test('recurring: H-1 lintas akhir bulan dan akhir tahun benar', () => {
    // today 2026-01-31 -> besok 2026-02-01
    let rs = computeDueReminders(baseCtx({ todayStr: '2026-01-31', recurring: [{ id: 'eom', active: true, next_due_date: '2026-02-01', kategori: 'Sewa', jumlah: 900000 }] }));
    assert.equal(rs.length, 1);
    // today 2026-12-31 -> besok 2027-01-01
    rs = computeDueReminders(baseCtx({ todayStr: '2026-12-31', recurring: [{ id: 'eoy', active: true, next_due_date: '2027-01-01', kategori: 'Sewa', jumlah: 900000 }] }));
    assert.equal(rs.length, 1);
});

// ---------------------------------------------------------------------------
// Preferensi & robustness
// ---------------------------------------------------------------------------
test('todayStr tidak valid -> hasil kosong, tidak mengarang', () => {
    assert.equal(computeDueReminders(baseCtx({ todayStr: '' })).length, 0);
    assert.equal(computeDueReminders(baseCtx({ todayStr: 'kacau' })).length, 0);
    assert.equal(computeDueReminders(null).length, 0);
});

test('normalizeReminderPrefs: default semua ON; false eksplisit mematikan', () => {
    assert.deepEqual(normalizeReminderPrefs(null), REMINDER_PREFS_DEFAULTS);
    assert.deepEqual(normalizeReminderPrefs({}), REMINDER_PREFS_DEFAULTS);
    const off = normalizeReminderPrefs({ budget: false, recurring: false, goals: false });
    assert.deepEqual(off, { budget: false, recurring: false, goals: false });
});

test('urutan hasil: budget-over paling depan, recurring paling belakang', () => {
    const rs = computeDueReminders(baseCtx({
        budgets: { A: 100, B: 100 },
        transactions: [
            { jenis: 'Pengeluaran', kategori: 'A', jumlah: 120, tanggal: TODAY },
            { jenis: 'Pengeluaran', kategori: 'B', jumlah: 85, tanggal: TODAY },
        ],
        goals: [{ id: 'g', nama: 'T', target: 10, terkumpul: 1, deadline: '2026-09-16' }],
        recurring: [{ id: 'r', active: true, next_due_date: '2026-09-16', kategori: 'C', jumlah: 1 }],
    }));
    assert.deepEqual(rs.map((r) => r.kind), ['budget-over', 'goal-deadline', 'budget-warning', 'recurring-due']);
});

// ---------------------------------------------------------------------------
// Dedup log
// ---------------------------------------------------------------------------
test('filterUnsent & mergeSentLog: id terkirim tidak terkirim ulang; kapasitas FIFO', () => {
    const reminders = [
        { id: 'a', kind: 'budget-over', title: 'A', body: '' },
        { id: 'b', kind: 'goal-deadline', title: 'B', body: '' },
    ];
    let log = {};
    const fresh = filterUnsent(reminders, log);
    assert.equal(fresh.length, 2);
    log = mergeSentLog(log, fresh.map((r) => r.id));
    assert.equal(filterUnsent(reminders, log).length, 0); // dobel tidak terjadi

    // kapasitas 3: a,b lalu c,d,e (a,b terbuang -> sisa c,d,e) lalu f (c terbuang -> sisa d,e,f)
    log = mergeSentLog(log, ['c', 'd', 'e'], 3);
    assert.deepEqual(log.__order, ['c', 'd', 'e']);
    log = mergeSentLog(log, ['f'], 3);
    assert.deepEqual(log.__order, ['d', 'e', 'f']);
    assert.equal(log.a, undefined);
    assert.equal(log.b, undefined);
    // 'a' sudah terbuang dari log -> sah untuk terkirim lagi (re-notify setelah lama)
    assert.equal(filterUnsent([reminders[0]], log).length, 1);
    assert.equal(filterUnsent([reminders[1]], log).length, 1);
});

test('mergeSentLog: id duplikat dalam satu pemanggilan tidak dobel di __order', () => {
    const log = mergeSentLog({}, ['x', 'x', 'y']);
    assert.deepEqual(log.__order, ['x', 'y']);
    assert.equal(log.x, 1);
});
