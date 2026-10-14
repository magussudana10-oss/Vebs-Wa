# VEBS WhatsApp AI Bot — Diagnostic Build

## Perilaku
- Chat pribadi: membalas pesan teks melalui Gemini.
- Grup: membalas jika teks/caption menyebut kata `vebs` (tidak peka huruf besar-kecil).
- Log diagnostik mencatat apakah pesan masuk berasal dari grup atau chat pribadi, apakah teks terdeteksi, dan apakah pemicu terdeteksi. Isi pesan dan nomor anggota tidak dicatat.
- Mencoba ulang error Gemini sementara (503/429/5xx).
- Model cadangan opsional melalui `GEMINI_FALLBACK_MODEL`.

## Railway Variables
- `GEMINI_API_KEY`: API key Gemini (rahasia)
- `GEMINI_MODEL`: model utama yang sudah dipastikan tersedia untuk API key
- `GEMINI_FALLBACK_MODEL`: opsional; isi hanya dengan model yang sudah dipastikan tersedia untuk API key
- `QR_PAGE_TOKEN`: token rahasia halaman QR
- `AUTH_DIR`: `/data/auth` jika Railway Volume terpasang pada `/data`
- `PORT`: disediakan otomatis oleh Railway

## Deploy
1. Ekstrak ZIP.
2. Ganti `server.js` di GitHub dengan file dari ZIP.
3. Commit changes dan tunggu Railway redeploy.
4. Jangan hapus Railway Volume atau sesi autentikasi.
5. Tes chat pribadi dengan `Halo VEBS`.
6. Tes grup dengan `Vebs, halo!`.
7. Buka Railway Logs dan cari `[WA IN] type=GROUP ... trigger=true`.

## Catatan
- Error 503 berasal dari ketersediaan model Gemini; retry tidak menjamin layanan selalu tersedia.
- Jangan commit API key, QR, token, atau sesi WhatsApp ke GitHub.
- Baileys adalah integrasi WhatsApp Web tidak resmi dan dapat berubah sewaktu-waktu.
