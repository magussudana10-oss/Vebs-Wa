# VEBS WhatsApp AI Bot — Fixed server.js

- Grup: membalas jika teks/caption mengandung kata `vebs` (tidak peka huruf besar/kecil).
- Chat pribadi: membalas pesan teks.
- Gemini: model utama `gemini-3.8-flash`, lalu fallback otomatis ke `gemini-3.6-flash` dan `gemini-3.5-flash-lite` jika terjadi gangguan/akses model.
- Diagnostik: `/status`, `/health`, dan log `[WA EVENT]` serta `[WA IN]`.
- QR page: `/qr?token=...`.

## Railway variables
Wajib: `GEMINI_API_KEY`, `QR_PAGE_TOKEN`.
Disarankan: `GEMINI_MODEL=gemini-3.8-flash`, `GEMINI_FALLBACK_MODEL=gemini-3.6-flash`, `AUTH_DIR=/data/auth` jika volume dipasang di `/data`.

`GEMINI_FALLBACK_MODEL` akan dicoba setelah model utama; kode juga mencoba model cadangan bawaan yang unik. Jangan menaruh API key, QR token, atau data sesi di GitHub.

## Deploy
Ganti `server.js` di repository `magussudana10-oss/Vebs-Wa` dengan file ini lalu commit. Pastikan Railway benar-benar melakukan redeploy dari commit baru. Jangan menghapus volume `/data/auth`.
