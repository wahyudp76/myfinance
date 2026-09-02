/** @type {import('tailwindcss').Config} */
// Build statis Tailwind (menggantikan Play CDN -- lihat commit migrasi).
// Content: SEMUA sumber yang memuat string kelas literal: index.html +
// app.js (v54: blok script monolit dipindah ke sini -- tanpa ini rebuild
// Tailwind akan membuang kelas yang dipakai app ke template literal) +
// modul src/ (renderer template-literal). Kelas yang dibangun lewat
// konkatenasi TIDAK ada di codebase ini (diaudit -- semua literal utuh),
// jadi tidak perlu safelist.
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './app.js', './src/**/*.js'],
  theme: { extend: {} },
  plugins: [],
};
