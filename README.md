# VEBS WhatsApp AI Bot

VEBS menghubungkan WhatsApp Web melalui Baileys dan menggunakan Gemini API untuk menjawab pesan teks pribadi.

## File
- `package.json` — dependensi dan perintah start
- `server.js` — server, halaman QR, koneksi WhatsApp, dan integrasi Gemini

## Environment variables Railway
- `GEMINI_API_KEY` — API key Gemini (rahasia)
- `GEMINI_MODEL` — model Gemini yang tersedia untuk akun Anda, misalnya `gemini-2.5-flash`
- `QR_PAGE_TOKEN` — token acak panjang untuk melindungi halaman QR
- `AUTH_DIR` — `/data/auth` jika menggunakan Railway Volume yang dipasang di `/data`
- `PORT` — disediakan otomatis oleh Railway

## Deploy
1. Upload file ke repository GitHub.
2. Hubungkan repository ke Railway sebagai service Node.js.
3. Tambahkan environment variables di atas.
4. Tambahkan Railway Volume dengan mount path `/data` agar sesi WhatsApp dapat dipertahankan.
5. Deploy dan tunggu log menunjukkan QR tersedia.
6. Buka `https://DOMAIN-RAILWAY/qr?token=TOKEN_RAHASIA`.
7. Di WhatsApp pilih Perangkat tertaut > Tautkan perangkat, lalu scan QR.

Status tersedia di `/status`.

## Catatan keamanan dan keandalan
- Jangan commit API key, QR, atau file sesi WhatsApp ke GitHub.
- Jangan bagikan URL halaman QR yang berisi token.
- QR login memberi akses ke akun WhatsApp. Scan hanya pada domain deployment Anda sendiri.
- Baileys merupakan library tidak resmi yang berinteraksi dengan WhatsApp Web. Koneksi dapat berubah atau logout; untuk kebutuhan bisnis kritis pertimbangkan WhatsApp Business Platform resmi.
- Sesi `useMultiFileAuthState` disimpan pada direktori yang ditentukan oleh `AUTH_DIR`. Gunakan volume persisten dan lindungi aksesnya.
- Riwayat chat disimpan sementara di memori dan hilang ketika proses restart.
