# VEBS AI Agent — RM Jawa Timur 5 (v2.0.0)

Paket ini memperkuat prompt AI VEBS agar berperan sebagai asisten analisis untuk pekerjaan RM Regional Jawa Timur 5, sambil mempertahankan integrasi WhatsApp Baileys, Gemini, endpoint QR/status, dan fitur analisis Excel yang sudah ada pada kode sumber.

## Fitur yang tersedia
- Chat WhatsApp pribadi; balasan grup jika pesan teks/caption mengandung kata `VEBS`.
- Instruksi AI khusus RM: repayment, portfolio quality, KPI, GAP, flow/movement, dan rekomendasi tindakan berbasis fakta.
- Riwayat percakapan per chat tersimpan di memori proses untuk konteks pertanyaan lanjutan; riwayat ini belum persisten setelah proses Railway restart.
- Analisis lampiran Excel `.xlsx`, `.xls`, `.xlsm`, atau `.csv`.
- Laporan seluruh data dalam file tanpa filter/scope area, daftar cabang diurutkan dari RR terendah untuk tiap bucket.
- Target KPI: Current/DPD 0 98%; DPD 1–30 55%; DPD 31–60 15%; DPD 61–90 7%.
- Bucket berdasarkan `dpd_old`; restruktur dikecualikan; Paid berdasarkan `payment_min_1x = Yes`; deduplikasi menggunakan `loan_id`.
- Movement dihitung dari `movement_label` setelah restruktur dikecualikan.
- `loan_state=CLOSED` tidak otomatis dikecualikan karena aturan tersebut belum dikonfirmasi.
- Endpoint `/health`, `/status`, dan `/qr?token=...`.
- Retry dan model fallback Gemini sesuai konfigurasi.

## Kolom wajib Excel
`loan_id`, `dpd_old`, `is_loan_restructured`, `payment_min_1x`.

Kolom tambahan untuk rincian cabang/movement: `branch_name` (atau `point_name`/`area_name`), `dpd_new`, `movement_label`, `cutoff_bucket`, `loan_state`.

Batas file: 20 MB dan 250.000 baris.

## Environment variables Railway
Wajib:
- `GEMINI_API_KEY`
- `QR_PAGE_TOKEN`

Disarankan/perlu sesuai deployment:
- `AUTH_DIR=/data/auth` jika persistent volume dipasang di `/data/auth`
- `GEMINI_MODEL`
- `GEMINI_FALLBACK_MODEL`
- `PORT` biasanya diberikan otomatis oleh Railway

## Deploy dengan aman
1. Backup kode repository dan catat environment variables yang ada.
2. Ganti `server.js` dan `package.json` dengan file dari paket ini.
3. Commit perubahan ke branch production yang benar dan deploy commit tersebut di Railway.
4. **Jangan menghapus persistent volume `/data/auth`**, jangan mengubah `AUTH_DIR` dari lokasi sesi yang aktif, dan jangan mengganti `GEMINI_API_KEY` atau `QR_PAGE_TOKEN`.
5. Setelah deploy, cek `/health` dan `/status` pada domain Railway.
6. Tes chat pribadi, tes pesan grup dengan kata `VEBS`, lalu kirim file Excel kecil sebagai tes.

## Menggunakan analisis Excel
- Chat pribadi: kirim file Excel langsung ke VEBS.
- Grup: lampirkan file dan tulis kata `VEBS` di caption, misalnya `VEBS analisis excel`.

## Batasan yang perlu diketahui
- Versi ini tidak melakukan monitoring proaktif terjadwal atau mengirim laporan otomatis; fitur itu memerlukan scheduler/automation dan sumber data yang ditentukan.
- Memori percakapan saat ini hanya berada di memori proses dan akan hilang saat service restart.
- Hasil analisis bergantung pada nama kolom dan kualitas data sumber. `loan_state=CLOSED` tetap dihitung jika tidak ada aturan lain yang dikonfirmasi.
- Uji di lingkungan aman sebelum menimpa produksi.
