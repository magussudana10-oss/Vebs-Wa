# VEBS WhatsApp Bot — Excel Analysis

## Fitur
- Membaca file Excel `.xlsx`, `.xls`, atau `.csv` yang dikirim ke WhatsApp.
- Chat pribadi: kirim file Excel langsung untuk analisis.
- Grup WhatsApp: lampirkan file dan sertakan kata `VEBS` pada caption, misalnya `VEBS analisis excel`.
- Tidak ada filter/scope area: analisis seluruh baris pada file; daftar seluruh cabang diurutkan dari RR terendah untuk setiap bucket.
- KPI: Current/DPD 0 98%; DPD 1–30 55%; DPD 31–60 15%; DPD 61–90 7%.
- Bucket menggunakan `dpd_old`; restru dikecualikan; Paid dihitung dari `payment_min_1x = Yes`; `loan_id` unik.
- Movement dihitung dari `movement_label` setelah restru dikecualikan.
- `loan_state=CLOSED` tidak otomatis dikecualikan pada versi ini karena aturan tersebut belum dikonfirmasi.
- Kolom wajib: `loan_id`, `dpd_old`, `is_loan_restructured`, `payment_min_1x`.
- Maksimum file 20 MB dan 250.000 baris.

## Deploy ke Railway
1. Ganti `server.js` dan `package.json` di GitHub dengan versi dari paket ini.
2. Commit perubahan, lalu pastikan Railway deploy commit terbaru (Auto Deploy harus aktif atau gunakan Deploy Latest Commit).
3. Jangan menghapus volume `/data/auth`, jangan mengganti `GEMINI_API_KEY` atau `QR_PAGE_TOKEN`.
4. Setelah deploy, kirim file Excel ke chat pribadi VEBS; untuk grup, tambahkan kata VEBS di caption.

## Contoh caption
`VEBS analisis excel`

## Variabel Railway yang tetap diperlukan
- `GEMINI_API_KEY`
- `QR_PAGE_TOKEN`
- `AUTH_DIR=/data/auth` jika volume dipasang pada `/data/auth`
- `GEMINI_MODEL` dan `GEMINI_FALLBACK_MODEL` untuk AI chat biasa
