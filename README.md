# VEBS AI Agent — RM Jawa Timur 5 (v2.2.0)

Paket ini merupakan upgrade inkremental dari versi yang diberikan. Integrasi WhatsApp Baileys, Gemini, endpoint QR/status, mekanisme retry/fallback, serta logika analisis Excel dipertahankan. Upgrade utama adalah instruksi AI khusus sebagai asisten pribadi Magus Sudana dan penyimpanan konteks percakapan secara persisten.

## Fitur
- Chat pribadi WhatsApp; balasan grup hanya jika teks/caption mengandung kata `VEBS`.
- Identitas AI: VEBS adalah asisten pribadi Magus Sudana, RM Regional Jawa Timur 5.
- Gaya analisis RM: ringkasan eksekutif, KPI/fakta, risiko yang didukung data, prioritas tindakan, dan tindak lanjut.
- Memori konteks percakapan disimpan ke file JSON sehingga dapat bertahan saat service restart jika file berada di Railway persistent volume.
- Konteks dibedakan per chat; konteks grup juga dipisahkan berdasarkan pengirim.
- Analisis lampiran Excel `.xlsx`, `.xls`, `.xlsm`, dan `.csv`; seluruh file tanpa filter/scope area.
- Target KPI: Current/DPD 0 = 98%; DPD 1–30 = 55%; DPD 31–60 = 15%; DPD 61–90 = 7%.
- Bucket berdasarkan `dpd_old`; restruktur dikecualikan; Paid berdasarkan `payment_min_1x = Yes`; deduplikasi `loan_id`.
- Movement tetap dibaca dari `movement_label` setelah restruktur dikecualikan.
- Endpoint `/health`, `/status`, dan `/qr?token=...`.
- Retry dan model fallback Gemini mengikuti konfigurasi.

## Kolom wajib Excel
`loan_id`, `dpd_old`, `is_loan_restructured`, `payment_min_1x`.

Kolom tambahan untuk rincian cabang/movement: `branch_name` (atau `point_name`/`area_name`), `dpd_new`, `movement_label`, `cutoff_bucket`, `loan_state`.

Batas file: 20 MB dan 250.000 baris.

## Environment variables Railway
Wajib:
- `GEMINI_API_KEY`
- `QR_PAGE_TOKEN`

Pertahankan sesuai deployment:
- `AUTH_DIR=/data/auth` jika volume sesi dipasang di `/data/auth`
- `GEMINI_MODEL`
- `GEMINI_FALLBACK_MODEL`
- `PORT` (umumnya diberikan Railway)

Memori:
- `VEBS_MEMORY_ENABLED=true` (default). Set `false` untuk menonaktifkan penyimpanan konteks.
- `VEBS_MEMORY_PATH=/data/vebs-memory.json` (default). Pastikan lokasi ini berada di persistent volume jika memori harus bertahan saat restart.

## Deploy dengan aman
1. Backup kode repository dan catat environment variables saat ini.
2. Ganti `server.js`, `package.json`, dan `README.md` dari paket ini.
3. Commit ke branch produksi yang benar, lalu deploy commit itu di Railway.
4. Jangan menghapus persistent volume `/data/auth`, jangan mengubah lokasi `AUTH_DIR`, dan jangan mengganti `GEMINI_API_KEY` atau `QR_PAGE_TOKEN`.
5. Jika volume Railway dipasang di `/data`, file memori default `/data/vebs-memory.json` akan berada di volume yang sama tetapi terpisah dari kredensial WhatsApp.
6. Setelah deploy, cek endpoint `/health` dan `/status`.
7. Tes chat pribadi, tes grup dengan kata `VEBS`, lalu tes file Excel kecil.

## Menggunakan analisis Excel
- Chat pribadi: kirim file Excel langsung ke VEBS.
- Grup: lampirkan file dan tulis kata `VEBS` di caption, misalnya `VEBS analisis excel`.

## Batasan yang perlu diketahui
- Memori persisten menyimpan teks percakapan dan jawaban AI pada disk. Batasi akses Railway dan jangan gunakan untuk menyimpan data rahasia seperti password, token, atau informasi autentikasi. Memori bukan sistem database terkelola; backup volume jika diperlukan.
- Maksimum 100 konteks percakapan terbaru disimpan dan masing-masing memiliki batas riwayat sesuai konfigurasi.
- Versi ini belum menjalankan laporan proaktif terjadwal. Untuk laporan otomatis, harus ditentukan sumber data, jadwal, dan aturan notifikasi terlebih dahulu.
- `loan_state=CLOSED` tidak otomatis dikecualikan; aturan itu belum dikonfirmasi.
- Hasil Excel bergantung pada kualitas data dan nama kolom sumber.
- `node --check` memeriksa sintaks saja; tetap lakukan pengujian fungsional di Railway sebelum mengganti produksi.


## Scope-aware Excel analysis (v2.2.0)
- Excel caption/perintah dapat meminta satu Area, Branch, atau Point saja, misalnya `VEBS analisa Area Jember saja`.
- Jika `area_name` tersedia, filter area diterapkan sebelum perhitungan KPI sehingga area lain tidak masuk hasil. Jika tidak ada area yang diminta, seluruh file tetap dianalisis.
- Jika nama scope tidak bisa dipastikan dari kolom yang tersedia, VEBS memberi pesan bahwa scope tidak ditemukan; tidak diam-diam mengganti ke area lain.
- Logika KPI yang ada tetap dipertahankan: bucket dari `dpd_old`, paid dari `payment_min_1x=Yes`, `loan_id` unik, dan restru dikecualikan.
- Filter scope dari caption hanya berlaku untuk analisis lampiran Excel; perintah teks tanpa lampiran tetap dijawab oleh Gemini sesuai konteks.
