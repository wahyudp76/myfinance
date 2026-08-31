/** @type {import('tailwindcss').Config} */
// Build statis Tailwind (menggantikan Play CDN -- lihat commit migrasi).
// Content: SEMUA sumber yang memuat string kelas literal: index.html +
// modul src/ (renderer template-literal). Kelas yang dibangun lewat
// konkatenasi TIDAK ada di codebase ini (diaudit -- semua literal utuh),
// jadi tidak perlu safelist.
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.js'],
  theme: { extend: {} },
  plugins: [],
};
