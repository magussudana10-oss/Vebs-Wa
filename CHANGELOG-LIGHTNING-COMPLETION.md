# VEBS v2.5.0 — Lightning Completion Patch

Patch terbatas untuk memperbaiki jawaban percakapan ringan yang sebelumnya berpotensi berhenti di tengah kalimat.

## Perubahan
- Batas output mode LIGHTNING dinaikkan dari 320 menjadi 800 token.
- Prompt LIGHTNING menegaskan bahwa jawaban harus selesai dalam kalimat utuh dan tidak berhenti di tengah kata/daftar.
- `finishReason` Gemini dicatat di log.
- Jika Gemini mengembalikan `MAX_TOKENS`, VEBS meminta kelanjutan dari bagian terakhir (maksimal dua kali) tanpa mengulang bagian sebelumnya.
- Batas output mode analisis/deep, fitur Excel, AMCOLL, memori, autentikasi WhatsApp, dan environment variables tidak diubah.

## Validasi yang dilakukan
- `node --check server.js` berhasil.
- `package.json` berhasil diparse sebagai JSON.

## Catatan
Belum dilakukan pengujian live terhadap Gemini atau WhatsApp dari paket ini. Setelah deployment, cek Railway logs untuk `finishReason` dan lakukan uji percakapan ringan serta permintaan rekomendasi.
