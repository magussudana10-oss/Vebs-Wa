# VEBS WhatsApp AI Bot — Group Mention

Bot WhatsApp berbasis Baileys dengan Gemini AI.

## Perilaku
- Di grup: merespons hanya jika pesan menyebut `vebs` (tidak peka huruf besar/kecil).
- Di chat pribadi: merespons pesan teks seperti sebelumnya.
- Balasan grup dikirim kembali ke grup asal.
- QR page dan status endpoint tetap tersedia.

## File
- `package.json`
- `server.js`
- `README.md`

## Railway Variables
- `GEMINI_API_KEY`: API key Gemini (rahasia)
- `GEMINI_MODEL`: model Gemini utama yang sudah tersedia untuk API key Anda
- `GEMINI_FALLBACK_MODEL`: opsional; model cadangan yang sudah dipastikan tersedia untuk API key Anda. Jika model utama mendapat 503/429/5xx, VEBS mencoba ulang lalu mencoba model cadangan.
- `QR_PAGE_TOKEN`: token rahasia untuk membuka halaman QR
- `AUTH_DIR`: `/data/auth` jika Railway Volume dipasang pada `/data`
- `PORT`: disediakan oleh Railway

## Penanganan error Gemini
Kode mencoba ulang error sementara (503/429/5xx) hingga tiga kali per model. Jika memakai `GEMINI_FALLBACK_MODEL`, pastikan nama model cadangan benar-benar tersedia untuk API key Anda.

## Deploy
1. Ekstrak ZIP.
2. Unggah file di dalam folder `vebs-whatsapp-group-bot` ke repository GitHub yang dipakai Railway.
3. Commit changes dan tunggu redeploy.
4. Pastikan Railway Volume persisten tetap terpasang di `/data`.
5. Uji di grup dengan pesan `Vebs, halo!`.

## Keamanan
Jangan commit API key, QR, token, atau sesi WhatsApp ke repository. Baileys adalah integrasi WhatsApp Web tidak resmi; koneksi dapat berubah atau logout.
