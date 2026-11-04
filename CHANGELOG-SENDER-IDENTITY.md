# VEBS additive upgrade — WhatsApp Sender Identity

## Baseline
Dibangun dari `server(20261104-095921).js` yang diberikan user pada 4 November 2026.

## Perubahan terbatas
- Mengambil nama pengirim dari `message.pushName` Baileys.
- Jika `pushName` kosong, mencoba fallback ke `sock.contacts[sender]` (name/notify/verifiedName).
- Jika nama tetap tidak tersedia, VEBS diarahkan memakai sapaan netral.
- Nama pengirim diteruskan sebagai konteks system instruction untuk chat pribadi maupun grup.
- Prompt menegaskan Magus Sudana adalah owner VEBS, bukan otomatis pengirim pesan.
- Verifikasi owner tetap hanya memakai exact JID `MAGUS_OWNER_JID`; nama profil tidak pernah digunakan untuk otorisasi.

## Tidak diubah
Excel/DPD/KPI, AMCOLL, Gemini fallback, Lightning Completion, Baileys/QR/reconnect, persistent memory, media/document processing, Railway paths dan environment variable.

## Validasi
`node --check server.js` dan parse `package.json` dilakukan. Belum dilakukan uji live WhatsApp multi-akun atau deployment Railway.
