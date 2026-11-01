# VEBS RM Jawa Timur 5 — Ultimate Upgrade v2.4.0

Paket ini dibuat sebagai upgrade aditif dari sumber VEBS v2.3.0 yang diberikan. Tujuannya mempertahankan analisis Excel DPD/KPI, Baileys/QR, Gemini retry/fallback, memori persisten, dan Auto Collection AMCOLL, sambil menambahkan pemanggilan grup berbasis mention, analisis gambar/PDF, dan penguatan instruksi percakapan.

> **Status:** paket sumber siap ditinjau dan diunggah setelah checklist konfigurasi dan pengujian. Tidak ada akses ke Railway atau spreadsheet produksi dalam proses pembuatan ini; deployment dan penulisan spreadsheet online belum diuji langsung. Jangan menganggapnya sudah live.

## Isi paket
- `server.js` — bot WhatsApp lengkap.
- `package.json` — dependencies dan start script; versi paket 2.4.0.
- `Code.gs` — endpoint Apps Script AMCOLL, ditambah dukungan batch `reports[]` dengan `LockService` global.
- `README.md` — panduan konfigurasi/deploy dan batasan.
- `TEST-PLAN.md` — checklist pengujian sebelum produksi.
- `.env.example` — daftar environment variable tanpa kredensial.

## Fitur yang dipertahankan
- WhatsApp Baileys QR, penyimpanan sesi `AUTH_DIR`, reconnect, endpoint `/health`, `/status`, dan `/qr`.
- Gemini primary/fallback dan retry.
- Histori percakapan persisten melalui `VEBS_MEMORY_PATH` pada volume `/data`.
- Analisis Excel `.xlsx/.xls/.xlsm/.csv`, scope Area/Branch/Point, dan aturan KPI: Current 98%, DPD 1–30 55%, DPD 31–60 15%, DPD 61–90 7%; bucket dari `dpd_old`, restruktur dikecualikan, Paid dari `payment_min_1x=Yes`, deduplikasi `loan_id` sesuai kode sumber.
- AMCOLL menerima format tetap `LoanID/Nominal Bayar` (contoh `123456/50000`); Apps Script mencari identitas dari Source berdasarkan Loan ID, memproses batch dalam satu LockService, memvalidasi duplikasi, dan memverifikasi penulisan sebelum konfirmasi berhasil. Nominal dinormalisasi menjadi angka sebelum dikirim.

## Penambahan v2.4.0
1. **Pemanggilan grup:** chat pribadi tetap bebas. Grup menjawab jika pesan diawali panggilan `VEBS` (contoh `VEBS bantu...`, `Hai VEBS...`) atau metadata WhatsApp menunjukkan mention aktual ke akun bot. Pesan grup tanpa pemanggilan diabaikan.
2. **Mention aktual:** mention aktual memberi ruang jawaban penuh (batas output lebih tinggi). Mention tekstual `@VEBS` saja tidak dianggap mention aktual kecuali WhatsApp menyertakan `mentionedJid` yang cocok dengan JID bot.
3. **AMCOLL:** format tetap `LoanID/Nominal Bayar` dan batch dapat diproses di grup tanpa memanggil VEBS. Server mengirim nominal numerik yang sudah dinormalisasi; Apps Script menerima array `reports[]`, mencari nama/customer number dari Source berdasarkan Loan ID, lalu memproses seluruh batch di dalam satu `LockService`. Loan ID yang tidak ditemukan atau tidak unik ditolak tanpa menulis data.
4. **Analisis visual:** gambar dan PDF yang dikirim ke chat pribadi dapat dianalisis; di grup harus disertai pemanggilan VEBS/mention aktual. Batas lampiran visual 18 MB.
5. **Owner:** verifikasi owner menggunakan `MAGUS_OWNER_JID` dan JID pengirim, bukan nama profil WhatsApp. Jika variable belum diisi, otorisasi owner gagal secara aman (fail closed).
6. **Percakapan adaptif dan Local Expert:** prompt ditingkatkan untuk bahasa campuran, slang, typo, konteks, ringkasan, rekomendasi wisata/kuliner Indonesia, dan kehati-hatian terhadap fakta yang belum terverifikasi.

## Penting: batasan Local Expert
Paket ini tidak menambahkan layanan pencarian web/Google Places live. VEBS dapat memberi panduan umum dan tautan pencarian Google Maps, tetapi tidak boleh mengklaim jam buka, harga, status tempat, atau kondisi terbaru telah diverifikasi. Untuk informasi terkini, pengguna perlu meminta verifikasi melalui sumber aktual/fitur pencarian yang dikonfigurasi terpisah.

## Konfigurasi Railway
Pertahankan variable lama yang sudah dipakai. Tambahkan/cek variable berikut:

| Variable | Keterangan |
|---|---|
| `GEMINI_API_KEY` | API key Gemini yang sudah digunakan |
| `GEMINI_MODEL` | Model utama; default di source `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODEL` | Model cadangan opsional |
| `QR_PAGE_TOKEN` | Token akses halaman QR yang sudah digunakan |
| `AUTH_DIR` | Lokasi sesi WhatsApp; pertahankan `/data/auth` bila itu konfigurasi sekarang |
| `VEBS_MEMORY_PATH` | Opsional; default `/data/vebs-memory.json` |
| `VEBS_MEMORY_ENABLED` | Opsional; default `true` |
| `AMCOLL_WEBAPP_URL` | URL Apps Script Web App `/exec` |
| `AMCOLL_API_TOKEN` | Sama dengan Script Property `VEBS_API_TOKEN` |
| `MAGUS_OWNER_JID` | JID owner lengkap, contoh format `62812xxxxxxx@s.whatsapp.net`; isi dengan JID/nomor owner yang benar |

Jangan menaruh API key, token, atau nomor owner dalam source code. Jangan menghapus Railway Volume `/data`, folder auth, atau file memory. Jangan mengubah `AUTH_DIR` dari nilai produksi tanpa alasan.

## Upload ke GitHub/Railway
1. Unduh ZIP dan ekstrak secara lokal.
2. Buat backup repository/branch aktif sebelum mengganti file.
3. Ganti `server.js`, `package.json`, `Code.gs` sesuai paket. Jangan menghapus file proyek lain yang masih dibutuhkan.
4. Untuk Apps Script: buka spreadsheet → Extensions → Apps Script. Backup isi `Code.gs` lama, lalu pasang `Code.gs` dari paket. Pastikan Script Property `VEBS_API_TOKEN` tetap ada dan sama dengan `AMCOLL_API_TOKEN` di Railway.
5. Deploy Apps Script sebagai Web App sesuai kebijakan akses organisasi; gunakan URL `/exec` pada `AMCOLL_WEBAPP_URL`.
6. Tambahkan `MAGUS_OWNER_JID` di Railway. Gunakan JID WhatsApp pribadi owner yang benar; jangan gunakan nama profil.
7. Pastikan Railway Volume tetap terpasang pada `/data` dan `AUTH_DIR` menunjuk ke sesi yang sudah ada.
8. Commit/push ke GitHub dan deploy Railway. Pantau deployment logs dan `/health`, `/status`.
9. Jangan hapus session atau scan QR ulang kecuali status WhatsApp memang meminta penautan ulang.

## Kontrak data AMCOLL yang dipertahankan
- Sheet sumber: `Source`.
- Sheet tujuan: `Data Collection Amcoll`.
- Kolom A:AC disalin dari Source; nominal pada AD.
- Header AD harus `nominal bayar`.
- Header identitas di Source dan tujuan: `customer_name`, `customer_number`, `loan_id` (variasi spasi/underscore diterima oleh normalizer). Pesan WhatsApp hanya perlu memuat Loan ID dan nominal; identitas customer diambil dari Source. Jika request lama menyertakan nama/customer number, keduanya tetap divalidasi.
- Apps Script menerima `reports[]`; semua laporan batch diproses berurutan dalam satu lock. Request single report tetap didukung. Input `50.000` maupun `50000` dinormalisasi menjadi 50000.
- Tetap verifikasi struktur A:AC pada spreadsheet aktual sebelum produksi. Kode tidak mengubah layout sheet.

## Owner dan aturan sapaan
Owner dicek menggunakan exact JID pengirim dan `MAGUS_OWNER_JID`. Pastikan JID di Railway benar. Prompt model diarahkan untuk tidak menerima perubahan aturan sapaan/identitas dari non-owner. Perlu diingat bahwa kontrol prompt adalah pengaman perilaku, bukan kontrol akses tingkat aplikasi untuk seluruh perintah administratif; jangan gunakan chat sebagai saluran pengelolaan secret.

## Rollback
1. Hentikan deployment baru melalui mekanisme rollback Railway atau kembalikan commit sebelumnya.
2. Kembalikan `server.js` dan `package.json` dari backup.
3. Jika Apps Script sudah diganti, pulihkan backup `Code.gs` sebelumnya atau deploy versi Apps Script sebelumnya.
4. Jangan menghapus `/data/auth`, `/data/vebs-memory.json`, atau data spreadsheet.

## Pengujian
Ikuti `TEST-PLAN.md` secara berurutan di lingkungan uji terlebih dahulu. Pengujian sintaks lokal tidak membuktikan WhatsApp, Gemini, Railway, atau Google Sheets produksi berfungsi.

## v2.4.1 Performance Optimization

- Timeout tunggu per permintaan Gemini: `GEMINI_REQUEST_TIMEOUT_MS` (default 12000 ms).
- Satu percobaan per model; jika model gagal, VEBS segera mencoba fallback berikutnya.
- Berlaku untuk chat dan analisis gambar/PDF.
- Pesan dalam satu event WhatsApp diproses konkuren; antrean per percakapan dan FIFO AMCOLL tetap dipertahankan.
- Timeout membatasi waktu tunggu VEBS, tetapi tidak menjamin provider membatalkan request yang sudah berjalan.
- Tidak mengubah target DPD, aturan Paid/restruktur, format AMCOLL, validasi Source, struktur sheet, hak owner, trigger grup, atau persistent memory.


## v2.4.2 — Ultra Speed Mode

Perubahan terbatas pada urutan model Gemini untuk percakapan:
- Model utama default: `gemini-3.6-flash`.
- Model fallback pertama: `gemini-3.8-flash`.
- Fallback berikutnya tetap mengikuti daftar model cadangan yang sudah ada, termasuk `gemini-3.5-flash-lite`.
- Timeout per permintaan tetap `GEMINI_REQUEST_TIMEOUT_MS` (default 12000 ms) dari v2.4.1.
- Batas satu percobaan per model dan fallback cepat tetap dipertahankan.

**PENTING UNTUK RAILWAY:** Environment variable mengalahkan default dalam kode. Pada Railway, atur:
- `GEMINI_MODEL=gemini-3.6-flash`
- `GEMINI_FALLBACK_MODEL=gemini-3.8-flash`
- Pertahankan `GEMINI_REQUEST_TIMEOUT_MS=12000` atau nilai yang sudah diuji.

Tidak ada perubahan pada Code.gs, format AMCOLL, FIFO, validasi Source, struktur spreadsheet, aturan Excel DPD/KPI, trigger DM/grup, owner security, memory, atau autentikasi WhatsApp. Paket tetap harus melalui pengujian regresi dan deployment belum dilakukan otomatis.
