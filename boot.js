/*! MyFinance -- boot.js (v98)
 * Blok <script type="module"> yang SEBELUMNYA inline di index.html, dipindah
 * BYTE-EXACT ke berkas terpisah (pola yang sama dipakai v54 utk app.js).
 *
 * KENAPA: service worker memakai NETWORK-FIRST untuk dokumen navigasi, tapi
 * stale-while-revalidate untuk aset. Selama 17 KB wiring ini inline, ia ikut
 * diunduh ulang SETIAP kunjungan online; sebagai berkas terpisah ia dijawab
 * dari cache. Dokumen turun 33,8 -> 29,8 KB gzip per navigasi.
 *
 * Isi di bawah TIDAK diubah sedikit pun (indentasi 8 spasi ikut dipertahankan)
 * supaya pemindahan ini bisa diverifikasi byte-per-byte terhadap riwayat git.
 */
        import {
            initAuthClient, getSession, getCurrentUser, signIn, signUp, signOut,
            onAuthStateChange, requireUser,
        } from './src/auth/index.js';
        import { createTransactionService, toCreateRecord, toUpdateRecord, mapTransactionRow } from './src/services/transactions.js';
        import { createTransfer, toTransferParams } from './src/services/supabase/transfers.js';
        import { createRecurringTransaction, toCreateRecurringParams, toRecurringRecord, listRecurring, createRecurring, updateRecurring, deleteRecurring, setRecurringActive, advanceRecurringDueDate } from './src/services/supabase/recurring.js';
        import { replaceMonthBudgets, fetchMonthBudgets } from './src/services/supabase/budgets.js';
        import { getSettings, saveSettings } from './src/services/supabase/settings.js';
        import { getCustomIcons, saveCustomIcon, deleteCustomIcon } from './src/services/supabase/custom-icons.js';
        import { listAssets, createAsset, updateAsset, deleteAsset, refreshAssetPrice } from './src/services/supabase/assets.js';
        import { advanceDueDate, planRecurringCatchup, summarizeRecurringStatus, classifyRecurringDueBadge } from './src/domain/recurring.js';
        // v92 (Fase 1A/1B): kunci aplikasi + pengingat proaktif — domain murni.
        import { normalizeLockConfig, isLockEnabled, isValidPinFormat, pinHashHex, verifyPin, nextLockoutState, isLockedOut, lockoutRemainingSec, shouldLockNow,
            biometricCredentialIds, hasBiometricCredential, addBiometricCredential, removeBiometricCredential, clearBiometricCredentials, biometricLabel, deviceLabelFromUserAgent, describeBiometricState } from './src/domain/app-lock.js';
        import { normalizeReminderPrefs, computeDueReminders, filterUnsent, mergeSentLog } from './src/domain/reminders.js';
        import { buildBackupPayload, validateBackupFile, summarizeBackupCounts, mapRestoreRows } from './src/domain/backup.js';
        import { buildDemoTransactions, isDemoTransaction, DEMO_MARKER } from './src/domain/demo-data.js';
        import { buildCommandIndex, searchCommands } from './src/domain/command-palette.js';
        import { pruneAccountKeyedMaps, validatePasswordChange, sanitizeIconOverride, isSafeClassToken, isSafeFaIconToken, isSafeIconImageUrl, sanitizeSettingsIconOverrides } from './src/domain/settings.js';
        import { buildTransactionsCsv, csvFileName, csvEscape, filterTransactionsForRange } from './src/domain/export-csv.js';
        import { summarizeAppData, formatBytes } from './src/domain/app-info.js';
        import { computeMarketValue, withSyncedValue, describeSyncSource, isBibitNavDate, formatNavDate } from './src/domain/market-sync.js';
        import { normalizeThemeColor, buildAccentShades, PRESET_THEMES, isColorCloseToAny, CHART_EXPENSE_REDS } from './src/domain/theme.js';
        import { getFocusable, nextTabTarget, pickTopModal, modalAccessibleName } from './src/ui/modal-a11y.js';
        import { dashboardSkeletonHtml } from './src/ui/skeletons.js';
        import { aggregateDashboardData } from './src/domain/dashboard.js';
        import { computeAccountTotals, buildAccountBalanceSeries, computeAccountChartSeries, resolveAccountCategoryDateRange, aggregateAccountExpenseByCategory, computeAccountGroupNet, isTransactionForAccount } from './src/domain/accounts.js';
        import { summarizeAssets, computeNetWorth } from './src/domain/assets.js';
        import { applyAssetDeposit, applyAssetDepositEdit, findAssetByName, resolveAssetDepositTx, pruneAssetShadowAccounts, syncAccountsFromTransactions } from './src/domain/asset-flows.js';
        import * as chartsUi from './src/ui/charts.js';
        import { computeFinancialHealthScore, computeFinancialInsights, buildInsightsContext } from './src/domain/insights.js';
        import { buildAiFinanceSummary } from './src/domain/ai-summary.js';
        import { computeGoalProgress, computeDebtProgress } from './src/domain/goals-debts.js';
        import { computeYearlySummary, computeMonthlyBreakdown, computeCategoryTrend } from './src/domain/reports.js';
        import { computeCalendarMonthSummary, buildDailyCashflowMap, projectRecurringDueDates } from './src/domain/calendar.js';
        import { resolveCategoryAndSubNames, computeCategoryDetailMonthChart, aggregateSubCategoryShares } from './src/domain/categories.js';
        import { matchesTransactionSearch, computeLast30DaysView, computeCustomMonthView, computeDateRangeView, isWithinAmountRange, computeDayNetTotal, insertTransactionRow, replaceTransactionRow } from './src/domain/transactions.js';
        import { isChartNarrow, selectSparseLabelIndices } from './src/domain/chart-labels.js';
        import { aggregateActualByCategory, classifyBudgetUsage, summarizeBudgets, detectBudgetThresholdCrossing, shiftMonthStr } from './src/domain/budgets.js';
        import { renderRecurringSummary as renderRecurringSummaryUI, renderRecurringListModal as renderRecurringListModalUI } from './src/ui/recurring.js';
        import { renderHealthScore as renderHealthScoreUI, renderInsights as renderInsightsUI } from './src/ui/insights.js';
        // v94: Rekomendasi AI (Gemini) -- list vertikal + modal detail (domain normalisasi
        // di src/domain/ai-recommendations.js; render di src/ui/ai-recommendations.js).
        import { normalizeAiRecommendations } from './src/domain/ai-recommendations.js';
        import { renderAiRecommendations as renderAiRecommendationsUI } from './src/ui/ai-recommendations.js';
        import { renderGoalIconColorPalette as renderGoalIconColorPaletteUI, renderGoalsList as renderGoalsListUI, renderDebtIconColorPalette as renderDebtIconColorPaletteUI, renderDebtsList as renderDebtsListUI } from './src/ui/goals-debts.js';
        import { renderAssetView as renderAssetViewUI } from './src/ui/assets.js';
        import { renderBudgetView as renderBudgetViewUI, renderBudgetModalList as renderBudgetModalListUI } from './src/ui/budgets.js';
        import { renderCategoryDetailMonthData as renderCategoryDetailMonthDataUI, renderCategorySubProportion } from './src/ui/categories.js';
        import { pickChartPalette, chartPaletteLabel } from './src/domain/chart-palette.js';
        import { buildDailyFlow, sparklineSvg } from './src/domain/sparkline.js';
        import * as chartHud from './src/domain/chart-hud.js';
        import { updateCalendarSummary as updateCalendarSummaryUI, renderCalendar as renderCalendarUI, openCalendarDetail as openCalendarDetailUI } from './src/ui/calendar.js';
        import { renderAccountDetailCharts as renderAccountDetailChartsUI } from './src/ui/accounts.js';
        import { suggestCategory, getExchangeRate, scanReceipt } from './src/services/supabase/edge.js';
        import { listPlatformLogos } from './src/services/supabase/platform-logos.js';
        // PILOT MIGRASI MONOLIT → MODUL (v71): helper format/monetary murni
        // (formatRp, txIdrAmount, formatShortVal, deepCloneDict) kini punya rumah
        // kanonik yang ter-tes unit di src/domain/format.js (lihat
        // tests/unit/format-domain.test.js). formatCtx() disediakan di sini
        // lewat jalur servicesModule yang sama dgn semua modul domain lain, agar
        // blok classic (monolit) bisa mulai MENGADOPInya tanpa menghapus definisi
        // global lama (proses bertahap: definisi global monolit dilepas per-feature
        // SETELAH konsistensi terverifikasi di test).
        import { formatCtx } from './src/domain/format.js';
        // PILOT MIGRASI (v73): helper tanggal murni (parseTgl/toDateStr/todayDateStr)
        // kini punya rumah kanonik ter-tes di src/domain/dates.js (pola sama dengan
        // src/domain/format.js). dateCtx() disediakan lewat jalur servicesModule agar
        // blok classic (monolit) mengadopsinya tanpa menghapus definisi global lama.
        import { dateCtx } from './src/domain/dates.js';
        // PILOT MIGRASI (v73): resolusi gaya/parent kategori murni (dari lookups)
        // di src/domain/category-style.js -- monolit men-delegasi dgn memasukkan
        // categoryDict/subCategoryLookup miliknya (lihat __catstyle).
        import { categoryStyleCtx } from './src/domain/category-style.js';
        // PILOT MIGRASI (v77): helper escape/pelolosan string murni
        // (escapeHtml/jsStr) di src/domain/sanitize.js -- satu sumber kebenaran
        // untuk lapisan anti-XSS render; monolit mengadopsinya via __sanitize.
        import { sanitizeCtx } from './src/domain/sanitize.js';
        // PILOT MIGRASI (v79): slug nama kategori/parent (src/domain/slugify.js)
        // & pemetaan kategori aset -> ikon (src/domain/asset-icons.js) murni.
        import { slugifyCtx } from './src/domain/slugify.js';
        import { assetIconCtx } from './src/domain/asset-icons.js';
        // PILOT MIGRASI (v81): database bank/e-wallet/aset + deteksi ikon otomatis
        // (src/domain/bank-icons.js) -- satu sumber kebenaran untuk logo akun & picker.
        import { bankIconCtx } from './src/domain/bank-icons.js';
        // PILOT MIGRASI (v86): pencocokan nama platform -> URL logo katalog DB
        // (src/domain/platform-logos.js) -- satu sumber kebenaran untuk lookup
        // platformLogoByKey di getAccountLogo (tab Aset, detail aset, akun).
        import { platformLogoCtx } from './src/domain/platform-logos.js';
        // PILOT MIGRASI (v82): resolusi mata uang default akun murni
        // (src/domain/account-currency.js) -- peta mata uang di-pass sbg DI.
        import { accountCurrencyCtx } from './src/domain/account-currency.js';

        window.__myfinanceAuth = {
            initAuthClient, getSession, getCurrentUser, signIn, signUp, signOut,
            onAuthStateChange, requireUser,
        };
        window.dispatchEvent(new Event('myfinance:auth-ready'));

        window.__myfinanceServices = {
            buildBackupPayload, validateBackupFile, summarizeBackupCounts, mapRestoreRows,
            buildDemoTransactions, isDemoTransaction, DEMO_MARKER,
            buildCommandIndex, searchCommands,
            createTransactionService, toCreateRecord, toUpdateRecord, mapTransactionRow, createTransfer, toTransferParams, createRecurringTransaction, toCreateRecurringParams, toRecurringRecord, listRecurring, createRecurring, updateRecurring, deleteRecurring, setRecurringActive, advanceRecurringDueDate, replaceMonthBudgets, fetchMonthBudgets,
            getSettings, saveSettings, getCustomIcons, saveCustomIcon, deleteCustomIcon,
            listAssets, createAsset, updateAsset, deleteAsset, refreshAssetPrice,
            applyAssetDeposit, applyAssetDepositEdit, findAssetByName, resolveAssetDepositTx, pruneAssetShadowAccounts, syncAccountsFromTransactions, // mekanisme setor ke aset (domain murni, src/domain/asset-flows.js)
            // planRecurringCatchup, advanceDueDate, & pruneAccountKeyedMaps sebenarnya domain
            // logic murni (src/domain/recurring.js, src/domain/settings.js), bukan service
            // Supabase -- ditumpangkan di bag yang sama supaya tidak perlu bikin Promise/event
            // loader ES module baru cuma utk beberapa fungsi kecil.
            planRecurringCatchup, advanceDueDate, summarizeRecurringStatus, classifyRecurringDueBadge, pruneAccountKeyedMaps,
            // v92 (Fase 1A/1B): kunci aplikasi + pengingat proaktif (domain murni,
            // src/domain/app-lock.js & src/domain/reminders.js).
            normalizeLockConfig, isLockEnabled, isValidPinFormat, pinHashHex, verifyPin, nextLockoutState, isLockedOut, lockoutRemainingSec, shouldLockNow,
            biometricCredentialIds, hasBiometricCredential, addBiometricCredential, removeBiometricCredential, clearBiometricCredentials, biometricLabel, deviceLabelFromUserAgent, describeBiometricState,
            normalizeReminderPrefs, computeDueReminders, filterUnsent, mergeSentLog,
            // Validasi bentuk override ikon/gaya (settings.js) -- dipakai blok classic sebagai
            // lapisan keamanan render & restore backup (lihat categoryIconHtml/renderAccountIconObj).
            sanitizeIconOverride, isSafeClassToken, isSafeFaIconToken, isSafeIconImageUrl, sanitizeSettingsIconOverrides,
            buildTransactionsCsv, csvFileName, csvEscape, filterTransactionsForRange, summarizeAppData, formatBytes, validatePasswordChange,
            computeMarketValue, withSyncedValue, describeSyncSource, isBibitNavDate, formatNavDate,
            buildDailyFlow, sparklineSvg, // sparkline HUD (src/domain/sparkline.js) -- domain murni
            chartHud, // DNA grafik garis HUD (src/domain/chart-hud.js)
            chartsUi, // builder config semua Chart.js (src/ui/charts.js) -- slice monolith 2026-09
            // aggregateDashboardData: domain logic murni juga (src/domain/dashboard.js), sama
            // seperti 3 fungsi di atas -- ditumpangkan di bag yang sama dengan alasan yang sama.
            aggregateDashboardData,
            computeAccountTotals, buildAccountBalanceSeries,
            computeAccountChartSeries, resolveAccountCategoryDateRange, aggregateAccountExpenseByCategory, computeAccountGroupNet, isTransactionForAccount,
            summarizeAssets, computeNetWorth,
            computeFinancialHealthScore, computeFinancialInsights, buildInsightsContext,
            buildAiFinanceSummary,
            computeGoalProgress, computeDebtProgress,
            // Tema warna (src/domain/theme.js): domain murni juga -- dipakai blok script
            // classic lewat servicesModule, pola yang sama dgn fungsi domain di atas.
            normalizeThemeColor, buildAccentShades, PRESET_THEMES, isColorCloseToAny, CHART_EXPENSE_REDS,
            // Aksesibilitas modal (src/ui/modal-a11y.js): pure helpers, dipakai blok classic.
            getFocusable, nextTabTarget, pickTopModal, modalAccessibleName,
            dashboardSkeletonHtml,
            computeYearlySummary, computeMonthlyBreakdown, computeCategoryTrend,
            computeCalendarMonthSummary, buildDailyCashflowMap, projectRecurringDueDates,
            resolveCategoryAndSubNames, computeCategoryDetailMonthChart,
            matchesTransactionSearch, computeLast30DaysView, computeCustomMonthView, computeDateRangeView, isWithinAmountRange, computeDayNetTotal, insertTransactionRow, replaceTransactionRow,
            isChartNarrow, selectSparseLabelIndices,
            aggregateActualByCategory, classifyBudgetUsage, summarizeBudgets, detectBudgetThresholdCrossing, shiftMonthStr,
            // renderRecurringSummaryUI/renderRecurringListModalUI: BUKAN domain/service, ini fungsi
            // UI/render (src/ui/recurring.js, menyentuh DOM) -- ditumpangkan di bag yang sama dengan
            // alasan yang sama seperti fungsi2 di atas (satu-satunya jalur modul ES ke classic script).
            renderRecurringSummaryUI, renderRecurringListModalUI,
            // renderHealthScoreUI/renderInsightsUI: idem, fungsi UI/render Skor Kesehatan &
            // Wawasan Keuangan (src/ui/insights.js).
            renderHealthScoreUI, renderInsightsUI,
            // v94: Rekomendasi AI (Gemini) -- domain normalisasi + UI list/modal detail.
            normalizeAiRecommendations, renderAiRecommendationsUI,
            // renderGoal*/renderDebt*UI: idem, fungsi UI/render Tujuan Keuangan & Utang
            // (src/ui/goals-debts.js).
            renderGoalIconColorPaletteUI, renderGoalsListUI, renderDebtIconColorPaletteUI, renderDebtsListUI,
            // renderAssetViewUI: idem, fungsi UI/render tab Aset & Portofolio
            // (src/ui/assets.js).
            renderAssetViewUI,
            // renderBudgetViewUI/renderBudgetModalListUI: idem, fungsi UI/render
            // tab Budget & modal Atur Budget (src/ui/budgets.js).
            renderBudgetViewUI, renderBudgetModalListUI,
            // renderCategoryDetailMonthDataUI: idem, fungsi UI/render bagian
            // bulan-spesifik halaman Kategori Detail (src/ui/categories.js).
            renderCategoryDetailMonthDataUI, renderCategorySubProportion,
            pickChartPalette, chartPaletteLabel,
            aggregateSubCategoryShares,
            // updateCalendarSummaryUI/renderCalendarUI/openCalendarDetailUI: idem,
            // fungsi UI/render tab Kalender & modal detail tanggal (src/ui/calendar.js).
            updateCalendarSummaryUI, renderCalendarUI, openCalendarDetailUI,
            // renderAccountDetailChartsUI: idem, fungsi UI/render chart di halaman
            // Detail Akun (src/ui/accounts.js).
            renderAccountDetailChartsUI,
            suggestCategory, getExchangeRate, scanReceipt, listPlatformLogos,
            // PILOT MIGRASI MONOLIT → MODUL (v71): set helper format/monetary kanonik
            // (src/domain/format.js) ter-tes unit, disediakan via jalur servicesModule
            // yang sama agar blok classic bisa mengadopsinya tanpa menghapus definisi
            // global lama terlebih dahulu.
            formatCtx,
            // PILOT MIGRASI (v73): helper tanggal kanonik (src/domain/dates.js).
            dateCtx,
            // PILOT MIGRASI (v73): resolusi gaya/parent kategori (src/domain/category-style.js).
            categoryStyleCtx,
            // PILOT MIGRASI (v77): helper escape/pelolosan string (src/domain/sanitize.js).
            sanitizeCtx,
            // PILOT MIGRASI (v79): slug + ikon kategori aset (src/domain/slugify.js, asset-icons.js).
            slugifyCtx,
            assetIconCtx,
            // PILOT MIGRASI (v81): database bank/e-wallet + deteksi ikon (src/domain/bank-icons.js).
            bankIconCtx,
            // PILOT MIGRASI (v86): pencocokan logo platform katalog DB (src/domain/platform-logos.js).
            platformLogoCtx,
            // PILOT MIGRASI (v82): resolusi mata uang akun murni (src/domain/account-currency.js).
            accountCurrencyCtx,
        };
        window.dispatchEvent(new Event('myfinance:services-ready'));
