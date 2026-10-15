# VEBS RM Jawa Timur 5 — v2.3.0 Auto Collection AMCOLL (Review Package)

Paket ini menambahkan fitur Auto Collection AMCOLL pada baseline VEBS v2.2.3. Fitur lama Excel DPD, KPI/Paid/restruktur, Baileys/QR, Gemini retry/fallback, dan perilaku chat tetap dipertahankan. Paket ini belum di-deploy dan belum diuji terhadap spreadsheet online karena akses Google Drive/Sheets langsung belum tersedia di sesi ini.

## Fitur tambahan
- Membaca laporan WhatsApp dengan field `customer_name`, `customer_number`, `loan_id`, `nominal bayar`.
- Diproses di chat pribadi atau grup (laporan terformat tidak wajib menyebut VEBS).
- Validasi ketiga identitas terhadap sheet `Source`.
- Tidak valid / ambigu: tidak menulis ke rekap dan memberi balasan kepada pengirim.
- Duplikat: identitas Customer Number + Loan ID + nominal sama ditolak. Nominal berbeda untuk pasangan Customer Number + Loan ID yang sama diterima sebagai laporan baru.
- Antrean FIFO global di VEBS dan `LockService` pada Apps Script.
- Menyalin nilai baris Source kolom A:AC ke baris berikutnya pada `Data Collection Amcoll`, mengisi nominal di kolom AD, lalu memverifikasi nilai sebelum balasan berhasil.
- Balasan berhasil mencantumkan nomor baris, ucapan terima kasih, dan penyemangat dengan nama pengirim.
- Idempotency juga memakai WhatsApp message ID bila destination sheet sudah memiliki kolom `whatsapp_message_id`; deteksi duplikat nominal tetap aktif tanpa kolom tersebut.

## Bagian penting sebelum produksi
1. Buka spreadsheet yang ditautkan, pastikan header `Source` memuat `customer_name`, `customer_number`, `loan_id` (spasi/underscore tidak masalah).
2. Pastikan header kolom AD di `Data Collection Amcoll` adalah `nominal bayar`.
3. Kode mengasumsikan data A:AC pada `Source` perlu disalin ke A:AC pada `Data Collection Amcoll`. Review dahulu jika struktur kedua sheet berbeda.
4. Pastikan row 1 adalah header dan `Data Collection Amcoll` memiliki header `customer_name`, `customer_number`, `loan_id` untuk deduplikasi.

## Konfigurasi Google Apps Script
1. Dari spreadsheet, buka **Extensions → Apps Script**.
2. Buat file `Code.gs` atau ganti isinya dengan file `Code.gs` dari paket ini.
3. Di **Project Settings → Script Properties**, tambahkan `VEBS_API_TOKEN` dengan token acak panjang yang Anda buat sendiri. Jangan kirim token ke chat.
4. Jalankan fungsi apa pun yang memicu otorisasi atau deploy web app sesuai permintaan Google.
5. Pilih **Deploy → New deployment → Web app**; execute as owner/developer. Batasi akses sesuai kebijakan akun. Endpoint publik harus tetap dilindungi token.
6. Salin URL Web App yang berakhiran `/exec`.

## Konfigurasi Railway (`Vebs-Wa`)
Tambahkan variable: `AMCOLL_WEBAPP_URL` = URL `/exec` dan `AMCOLL_API_TOKEN` = nilai yang sama dengan Script Property `VEBS_API_TOKEN`. Simpan token hanya di Railway dan Apps Script Properties, bukan di kode/ChatGPT. Jangan mengubah `GEMINI_API_KEY`, `QR_PAGE_TOKEN`, `AUTH_DIR`, atau volume `/data/auth`.

## Pengujian wajib sebelum deployment produksi
- Laporan valid -> baris baru, AD berisi nominal, balasan mencantumkan nomor baris.
- Tiap field identitas salah -> tidak ada penulisan.
- Identitas + nominal sama -> duplikat, tidak ada baris baru.
- Customer Number + Loan ID sama tetapi nominal berbeda -> baris baru.
- Dua laporan valid berdekatan -> baris berurutan.
- Pesan WhatsApp sama dikirim ulang -> tidak menulis dua kali.
- Kegagalan endpoint/timeout -> VEBS tidak memberi konfirmasi berhasil.

## Validasi paket yang dilakukan
- `node --check server.js`
- Validasi JSON `package.json`
- Pemeriksaan sintaks sederhana `Code.gs` (perlu diuji final melalui Apps Script editor)

Ini paket untuk review; jangan deploy ke Railway production sebelum sheet mapping dan pengujian di atas diverifikasi.
