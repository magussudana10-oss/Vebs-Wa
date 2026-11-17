# VEBS v2.6.0 — Integrated Upgrade Candidate

Paket ini dibangun dari source aktif VEBS v2.5.0 yang diunggah pada 16 November 2026. Fungsi utama v2.5.0 dipertahankan, termasuk WhatsApp Baileys, Gemini fallback, analisis Excel repayment, image/document/video analysis, sender identity, owner JID authorization, dan AMCOLL.

## Fitur upgrade

1. **Batch otomatis 5 kategori** — empat file repayment (Current/DPD 0, DPD 1–30, DPD 31–60, DPD 61–90) dikumpulkan per chat, periode, dan scope. Setelah keempatnya lengkap dan lolos validasi, VEBS mengambil snapshot Disbursement read-only dari Google Sheets. Laporan dikirim otomatis setelah kelima kategori valid.
2. **Disbursement** — sumber tab `__DASH_INDEX`; NOA dihitung dari `loan_id` unik, nominal dari total `plafond`, rekap per Point dan total Regional Jawa Timur 5. Hanya status `Gagal Dicairkan` yang dikecualikan; status lain dihitung.
3. **Group Context** — konteks sementara bersama per grup, TTL 30 menit, maksimum 100 pesan/18.000 karakter, tidak disimpan sebagai konteks grup bersama di file permanen. Riwayat per pengirim tetap mengikuti mekanisme v2.5.0.
4. **Owner Knowledge Memory** — simpan, lihat, perbarui, dan hapus catatan permanen. Add/update/delete hanya diterima dari JID yang sama persis dengan `MAGUS_OWNER_JID`. Update meminta konfirmasi kedua sebelum mengganti catatan.

## Cara Batch

- Kirim empat file repayment ke chat yang sama.
- Nama file atau caption harus menandai kategori, misalnya `Current DPD0`, `DPD1-30`, `DPD31-60`, `DPD61-90`.
- Cantumkan periode pada nama file/caption, misalnya `Periode Oktober 2026` atau tanggal `20261024`. Batch tanpa periode ditolak agar data beda periode tidak tercampur.
- File harus berisi satu bucket DPD saja dan memiliki kolom `loan_id`, `dpd_old`, `is_loan_restructured`, `payment_min_1x`.
- Jika ada scope, gunakan scope yang sama pada keempat file/caption (contoh `Area Jember`). Scope yang berbeda akan membentuk batch berbeda.
- Setelah empat file valid, VEBS mengambil Disbursement dari Google Sheets. Jika akses Sheets gagal, empat file disimpan sementara selama maksimal 2 jam. Setelah akses diperbaiki, kirim `VEBS proses batch` untuk mencoba lagi.
- Batch disimpan di memori proses Railway, bukan ke file permanen; jika service restart sebelum batch selesai, file harus dikirim ulang.

## Perintah Owner Knowledge Memory

Contoh perintah (harus dari nomor/JID owner terverifikasi):

- `VEBS ingat target minggu ini 98%`
- `VEBS simpan pencapaian Point Jember: ...`
- `VEBS daftar memori`
- `VEBS perbarui catatan target minggu ini menjadi: ...`
- Setelah VEBS memberi ID konfirmasi: `VEBS konfirmasi update memori mem-...`
- `VEBS batalkan update memori mem-...`
- `VEBS hapus catatan target minggu ini`

Catatan yang ingin dibagikan ke grup dapat ditandai dengan `(boleh dibagikan)`. Memori owner lainnya tetap privat.

## Deploy ke Railway

1. **Jangan hapus atau mengganti nilai secret Railway yang sudah aktif.** Pertahankan `GEMINI_API_KEY`, `QR_PAGE_TOKEN`, `MAGUS_OWNER_JID`, `AMCOLL_WEBAPP_URL`, `AMCOLL_API_TOKEN`, dan konfigurasi lain yang sekarang berjalan.
2. Pastikan Railway menggunakan Node.js 20 atau lebih baru dan Start Command `npm start`.
3. Pertahankan Railway Volume yang sama pada `/data`. Jangan hapus `/data/auth` atau `/data/vebs-memory.json`; keduanya berisi sesi WhatsApp dan memori yang sudah ada.
4. Tambahkan variable berikut jika belum ada:
   - `DISBURSEMENT_SHEET_ID=107Pnn4Rzm8bc9WuwVUhlmahNuzikyQX4xg8XbLPMi0w`
   - `DISBURSEMENT_SHEET_NAME=__DASH_INDEX`
   - `VEBS_MEMORY_PATH=/data/vebs-memory.json`
5. Upload isi folder paket ke repository/deployment Railway (bukan folder ZIP bersarang), lalu deploy.
6. Periksa `/health` dan `/status`. Pastikan `ownerAuthorization` menunjukkan `configured`, dan WhatsApp tersambung.
7. Uji satu batch kecil terlebih dahulu. Pastikan spreadsheet tetap `Anyone with the link – Viewer` dan nama tab persis `__DASH_INDEX`.

`Code.gs` disertakan sebagai salinan companion AMCOLL; tidak perlu diubah atau di-deploy ulang untuk upgrade server ini.

## Pengujian dan batas verifikasi

- `node --check server.js`: harus lolos.
- `npm test`: unit test helper batch, metadata, disbursement, memory command, dan isolasi group context.
- ZIP integrity: diperiksa sebelum paket dibagikan.
- **Belum dapat diuji dari lingkungan pembuatan paket:** koneksi live ke Google Sheets, koneksi WhatsApp/Baileys, Railway Volume, dan integrasi AMCOLL di deployment Anda. Koneksi live Google Sheets perlu dipastikan saat smoke test Railway. Paket tidak berisi secret.

## Rollback

Folder `ROLLBACK/` berisi source `server.js` dan `package.json` v2.5.0 aktif 16 November 2026. Jika deployment bermasalah, pulihkan kedua file tersebut tanpa menghapus Railway Volume `/data`.
