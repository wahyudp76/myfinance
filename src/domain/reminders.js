/**
 * src/domain/reminders.js — Pengingat proaktif (v92 / Fase 1B).
 *
 * Domain MURNI: menghitung DAFTAR pengingat yang jatuh tempo dari data yang
 * sudah ada di memori (transaksi, budget bulan berjalan, tujuan keuangan,
 * template transaksi berulang). Tanpa DOM, tanpa Notification, tanpa storage —
 * penyajian & pencatatan "sudah terkirim" jadi urusan orkestrasi di app.src.js
 * (supaya bisa di-unit-test penuh di sini, lihat tests/unit/reminders-domain.test.js).
 *
 * JENIS PENGINGAT (semua idempoten lewat ID unik per periode+ambang):
 *  1. budget    — pengeluaran bulan berjalan sebuah kategori mencapai >=80%
 *                 (peringatan) atau >=100% (jebol) dari anggarannya. 80% dan
 *                 100% adalah DUA pengingat berbeda (id berbeda) supaya keduanya
 *                 sah terjadi pada bulan yang sama seiring pengeluaran naik.
 *  2. recurring — template aktif yang jatuh tempo BESOK (H-1): tagihan/gaji
 *                 yang besok dicatat otomatis. Yang sudah overdue TIDAK dibuat
 *                 pengingatnya di sini — processDueRecurring() sudah mencatatnya
 *                 otomatis + toast ringkasan di dalam app (dua kali ingat = noise).
 *  3. goals     — tujuan keuangan yang belum tercapai dan deadlinenya tinggal
 *                 7 hari (H-7) atau 1 hari (H-1).
 *
 * FORMAT default angka: fungsi formatRp disuntik lewat ctx (pola dependency
 * injection sama seperti insights.js); fallback = toLocaleString('id-ID').
 */

/** Preferensi default: semua jenis AKTIF (opt-out per jenis dari Pengaturan). */
export const REMINDER_PREFS_DEFAULTS = { budget: true, recurring: true, goals: true };

export function normalizeReminderPrefs(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    return {
        budget: p.budget !== false,
        recurring: p.recurring !== false,
        goals: p.goals !== false,
    };
}

/** Tambah 1 hari pada 'YYYY-MM-DD' (aman zona waktu: operasi komponen lokal). */
function addDaysStr(dateStr, days) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setDate(dt.getDate() + days);
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

function daysBetweenStr(fromStr, toStr) {
    const [y1, m1, d1] = String(fromStr).split('-').map(Number);
    const [y2, m2, d2] = String(toStr).split('-').map(Number);
    const a = Date.UTC(y1, (m1 || 1) - 1, d1 || 1);
    const b = Date.UTC(y2, (m2 || 1) - 1, d2 || 1);
    return Math.round((b - a) / 86400000);
}

const defaultFmt = (n) => Number(n || 0).toLocaleString('id-ID');

/**
 * Hitung seluruh pengingat yang jatuh tempo.
 *
 * @param {object} ctx
 *   - transactions : array baris transaksi (bentuk DB: {jenis, kategori, jumlah, tanggal})
 *   - budgets      : peta { namaKategori: nominal } untuk BULAN BERJALAN (cloudBudgets)
 *   - goals        : array tujuan ({id, nama, target, terkumpul, deadline})
 *   - recurring    : array template ({id, active, next_due_date, frequency, jenis, kategori, jumlah, keterangan})
 *   - todayStr     : 'YYYY-MM-DD' hari ini (disuntik, bukan new Date() internal)
 *   - formatRp     : optional (n) => string
 * @param {object} prefsRaw — preferensi per jenis (dinormalisasi di sini)
 * @returns {Array<{id, kind, title, body}>} — terurut: budget-over dulu, lalu
 *   goals, lalu budget-warning, lalu recurring (paling mendesak di depan).
 */
export function computeDueReminders(ctx, prefsRaw) {
    const prefs = normalizeReminderPrefs(prefsRaw);
    const c = ctx || {};
    const todayStr = String(c.todayStr || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayStr)) return []; // tanpa tanggal valid, jangan mengarang pengingat
    const fmt = typeof c.formatRp === 'function' ? c.formatRp : defaultFmt;
    const out = [];

    // ---------- 1. BUDGET: pakai vs anggaran bulan berjalan ----------
    if (prefs.budget && c.budgets && typeof c.budgets === 'object') {
        const monthStr = todayStr.slice(0, 7);
        const spendByCat = {};
        (c.transactions || []).forEach((t) => {
            if (!t || t.jenis !== 'Pengeluaran') return;
            const tanggal = String(t.tanggal || '');
            if (tanggal.slice(0, 7) !== monthStr) return;
            const cat = String(t.kategori || '');
            if (!cat) return;
            spendByCat[cat] = (spendByCat[cat] || 0) + (Math.abs(Number(t.jumlah)) || 0);
        });
        Object.keys(c.budgets).forEach((cat) => {
            const budgetAmt = Number(c.budgets[cat]) || 0;
            if (budgetAmt <= 0) return;
            const spent = spendByCat[cat] || 0;
            const pct = (spent / budgetAmt) * 100;
            if (pct >= 100) {
                out.push({
                    id: 'budget:' + monthStr + ':100:' + cat,
                    kind: 'budget-over',
                    title: 'Budget "' + cat + '" sudah jebol (' + Math.round(pct) + '%)',
                    body: 'Terpakai Rp ' + fmt(spent) + ' dari budget Rp ' + fmt(budgetAmt) + ' bulan ini.',
                });
            } else if (pct >= 80) {
                out.push({
                    id: 'budget:' + monthStr + ':80:' + cat,
                    kind: 'budget-warning',
                    title: 'Budget "' + cat + ' hampir habis (' + Math.round(pct) + '%)',
                    body: 'Sisa Rp ' + fmt(budgetAmt - spent) + ' dari budget Rp ' + fmt(budgetAmt) + ' bulan ini.',
                });
            }
        });
    }

    // ---------- 2. TUJUAN KEUANGAN: tenggat H-7 / H-1 ----------
    if (prefs.goals && Array.isArray(c.goals)) {
        c.goals.forEach((g) => {
            if (!g || !g.deadline) return;
            const target = Number(g.target) || 0;
            const terkumpul = Number(g.terkumpul) || 0;
            if (target > 0 && terkumpul >= target) return; // sudah tercapai -> tidak perlu dikejar
            const daysLeft = daysBetweenStr(todayStr, String(g.deadline));
            if (daysLeft !== 7 && daysLeft !== 1) return;
            const pct = target > 0 ? Math.min(100, Math.round((terkumpul / target) * 100)) : 0;
            out.push({
                id: 'goal:' + g.id + ':' + String(g.deadline) + ':H' + daysLeft,
                kind: 'goal-deadline',
                title: 'Tujuan "' + (g.nama || 'tanpa nama') + (daysLeft === 1 ? '" tinggal 1 hari' : '" tinggal 7 hari'),
                body: 'Terkumpul Rp ' + fmt(terkumpul) + ' dari Rp ' + fmt(target) + ' (' + pct + '%).',
            });
        });
    }

    // ---------- 3. TRANSAKSI BERULANG: jatuh tempo BESOK ----------
    if (prefs.recurring && Array.isArray(c.recurring)) {
        const tomorrowStr = addDaysStr(todayStr, 1);
        (c.recurring || []).forEach((r) => {
            if (!r || r.active !== true) return;
            if (String(r.next_due_date || '') !== tomorrowStr) return;
            const label = r.keterangan || r.kategori || 'transaksi rutin';
            out.push({
                id: 'recurring:' + r.id + ':' + tomorrowStr,
                kind: 'recurring-due',
                title: 'Besok jatuh tempo: ' + label,
                body: (r.jenis === 'Pemasukan' ? 'Pemasukan' : r.jenis === 'Transfer' ? 'Transfer' : 'Pengeluaran') +
                    ' Rp ' + fmt(Math.abs(Number(r.jumlah)) || 0) + ' akan tercatat otomatis (' + (r.kategori || '-') + ').',
            });
        });
    }

    // Urutan tampil: paling mendesak dulu. (HATI-HATI: rank 0 adalah falsy —
    // pakai pengecekan eksplisit undefined, BUKAN `|| 9`.)
    const KIND_ORDER = { 'budget-over': 0, 'goal-deadline': 1, 'budget-warning': 2, 'recurring-due': 3 };
    const rank = (k) => (KIND_ORDER[k] !== undefined ? KIND_ORDER[k] : 9);
    return out.sort((a, b) => rank(a.kind) - rank(b.kind));
}

/** Ambil hanya pengingat yang belum pernah terkirim (log = {id: 1}). */
export function filterUnsent(reminders, sentLog) {
    const log = sentLog && typeof sentLog === 'object' ? sentLog : {};
    return (reminders || []).filter((r) => r && r.id && !log[r.id]);
}

/**
 * Gabungkan id yang baru terkirim ke log lama, buang yang paling tua bila
 * melebihi kapasitas (FIFO sederhana: urutan penyisipan dipertahankan via
 * array paralel `__order` yang ikut disimpan — log berbentuk plain object
 * supaya JSON-serializable ke localStorage tanpa migrasi).
 */
export function mergeSentLog(sentLog, newIds, cap) {
    const max = Number(cap) || 200;
    const log = sentLog && typeof sentLog === 'object' ? sentLog : {};
    const order = Array.isArray(log.__order) ? log.__order.slice() : Object.keys(log).filter((k) => k !== '__order');
    (newIds || []).forEach((id) => {
        if (!id) return;
        if (!(id in log)) order.push(id);
        log[id] = 1;
    });
    while (order.length > max) {
        const oldest = order.shift();
        delete log[oldest];
    }
    log.__order = order;
    return log;
}
