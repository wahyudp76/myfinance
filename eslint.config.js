// ============================================================================
// ESLint flat config — MyFinance
// ============================================================================
// KENAPA ADA: sampai sebelum ini repo TIDAK punya linter sama sekali. Suite unit
// (500 tes) menjaga PERILAKU, tapi tidak ada yang menjaga kelas kesalahan yang
// baru muncul saat runtime di browser user: variabel salah ketik, `case` yang
// lupa `break`, promise yang dibuat tapi tidak di-`await`, import yang tidak
// terpakai setelah refactor, `==` vs `===`. Linter menangkap itu di CI, gratis,
// sebelum ter-deploy ke GitHub Pages.
//
// FILOSOFI KONFIGURASI: sengaja KETAT pada hal yang bisa jadi bug beneran
// (no-undef, no-unused-vars, eqeqeq, no-fallthrough) dan sengaja DIAM soal
// gaya penulisan (indentasi, kutip, titik koma) -- gaya tulisan repo ini sudah
// konsisten dan me-reformat 6.000 baris cuma akan mengubur riwayat git.
//
// CAKUPAN: hanya modul ES di `src/`, `tests/`, `scripts/`, `sw.js`, dan helper
// `.js` Edge Function. Blok <script> inline di index.html TIDAK di-lint di sini
// -- gerbangnya sudah ada di tests/unit/index-inline-scripts.test.js (cek
// sintaks), dan file .ts Deno butuh parser TypeScript (di luar cakupan).
//
// Jalankan: `npm run lint` (atau `npm run lint:fix`).

// CATATAN DEPENDENSI: `@eslint/js` WAJIB terdaftar eksplisit di devDependencies,
// bukan mengandalkan hoisting dari paket `eslint`. Sampai ESLint 9 paket ini
// kebetulan ikut ter-install sebagai dependensi transitif sehingga import ini
// jalan; ESLint 10 tidak lagi begitu, dan CI langsung mati dengan
// ERR_MODULE_NOT_FOUND. Ketahuan dari PR Dependabot yang menaikkan ESLint ke 10.
import js from "@eslint/js";
import globals from "globals";

/** Aturan bersama semua lingkungan — kelas bug, bukan gaya penulisan. */
const sharedRules = {
  // --- Kebenaran ---
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  "no-unused-vars": [
    "error",
    {
      args: "after-used",
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrors: "all",
      // `const { id, user_id, ...rest } = row` adalah cara idiomatis MEMBUANG
      // kolom -- `id`/`user_id` di situ memang sengaja tidak dipakai.
      ignoreRestSiblings: true,
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "no-fallthrough": "error",
  "no-return-assign": ["error", "always"],
  "no-self-compare": "error",
  // MATI: satu-satunya temuan di repo ini adalah FALSE POSITIVE --
  // `while (cursor <= endCursor)` di src/domain/transactions.js memajukan loop
  // lewat MUTASI objek Date (`cursor.setMonth(...)`), bukan penugasan ulang
  // variabel, dan aturan ini tidak bisa melihat mutasi tersebut.
  "no-unmodified-loop-condition": "off",
  "no-unreachable-loop": "error",
  "no-constant-binary-expression": "error",

  // --- Async: sumber bug senyap paling umum di app ini (banyak await Supabase) ---
  "require-atomic-updates": "error",
  "no-async-promise-executor": "error",
  "no-await-in-loop": "off", // dipakai sengaja (refresh harga aset sekuensial, v43)

  // --- Kebersihan ---
  "no-console": ["warn", { allow: ["warn", "error"] }],
};

export default [
  {
    // Artefak build & dependensi — jangan pernah di-lint.
    ignores: [
      "node_modules/**",
      "css/**",
      "webfonts/**",
      "fonts/**",
      "icons/**",
      "docs/**",
      "sql/**",
      "supabase/functions/**/*.ts", // Deno + TypeScript: butuh parser terpisah
      "package-lock.json",
    ],
  },

  js.configs.recommended,

  {
    // --- Modul aplikasi: berjalan DI BROWSER ---
    files: ["src/**/*.js", "supabase/functions/_shared/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: sharedRules,
  },

  {
    // --- Service worker: global-nya BEDA dari window (self, clients, caches) ---
    files: ["sw.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...globals.serviceworker },
    },
    rules: sharedRules,
  },

  {
    // --- Tes & skrip perkakas: berjalan DI NODE ---
    files: ["tests/**/*.js", "tests/**/*.mjs", "scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      ...sharedRules,
      // Skrip perkakas memang berkomunikasi lewat stdout — itu memang gunanya.
      "no-console": "off",
    },
  },

  {
    // --- tailwind.config.js: satu-satunya file CommonJS yang tersisa ---
    files: ["tailwind.config.js"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
  },

  {
    // --- Tes yang menjalankan kode DI DALAM browser (page.evaluate) ---
    // Callback Playwright dieksekusi di konteks halaman, jadi `document`,
    // `window`, dst. memang ada meski file-nya sendiri file Node.
    files: ["scripts/verify-hud.mjs", "tests/parity/**/*.mjs", "scripts/rls-audit/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        // ------------------------------------------------------------------
        // PERMUKAAN GLOBAL APLIKASI (kontrak monolit <-> harness E2E)
        // ------------------------------------------------------------------
        // Callback page.evaluate() dieksekusi DI DALAM halaman, jadi nama-nama
        // di bawah ini memang ada saat runtime -- semuanya didefinisikan oleh
        // blok <script> gabungan di index.html. Sengaja didaftar SATU PER SATU
        // (bukan mematikan no-undef untuk file ini) supaya daftar ini menjadi
        // dokumentasi hidup: inilah PERSIS permukaan global yang masih
        // dipertahankan monolit, dan setiap nama yang hilang di sini saat
        // Phase 4 refactor berjalan akan langsung ketahuan sebagai lint error
        // alih-alih sebagai tes E2E yang gagal misterius.
        Chart: "readonly",
        ASSET_AUTO_UPDATE_CONFIG: "readonly",
        appSettings: "readonly",
        charts: "readonly",
        // DITULIS (bukan cuma dibaca) oleh harness saat membersihkan aset
        // sementara "tmp-kripto" -- lihat scripts/verify-hud.mjs.
        globalAssets: "writable",
        globalData: "readonly",
        _confirmYes: "readonly",
        applyDefaultViewOnce: "readonly",
        closeAssetDetailModal: "readonly",
        closeAssetModal: "readonly",
        closeBudgetModal: "readonly",
        closeCategorySelector: "readonly",
        closeManualNavModal: "readonly",
        closeModal: "readonly",
        closeProfileModal: "readonly",
        copyPrevMonthBudget: "readonly",
        handleFormTypeChange: "readonly",
        loadData: "readonly",
        openAccountDetail: "readonly",
        openAssetDetailModal: "readonly",
        openAssetModal: "readonly",
        openBudgetModal: "readonly",
        openCategoryDetail: "readonly",
        openCategorySelector: "readonly",
        openManualNavModal: "readonly",
        openProfileModal: "readonly",
        previewManualNav: "readonly",
        selectCategoryItem: "readonly",
        setDefaultView: "readonly",
        submitForm: "readonly",
        submitManualNav: "readonly",
        switchView: "readonly",
        todayDateStr: "readonly",
        toggleAssetAutoUpdateSection: "readonly",
        txIdrAmount: "readonly",
      },
    },
  },
];
