VEBS v2.6.0 — PANDUAN UPLOAD RAILWAY

1. Pertahankan seluruh Railway Variables yang sudah aktif. Jangan mengganti API key, QR token, owner JID, AMCOLL URL/token.
2. Pertahankan Railway Volume yang sama dan mount ke /data. Jangan hapus /data/auth atau /data/vebs-memory.json.
3. Tambahkan DISBURSEMENT_SHEET_ID dan DISBURSEMENT_SHEET_NAME sesuai .env.example bila belum ada.
4. Upload isi folder ini ke root repository Railway. Start command: npm start. Node >=20.
5. Setelah deploy, cek /health dan /status, lalu lakukan uji batch kecil.
6. Jika terjadi masalah, pulihkan server.js dan package.json dari folder ROLLBACK. Jangan hapus Volume /data.

PENTING: koneksi live Google Sheets, WhatsApp, dan AMCOLL belum dapat diuji dari lingkungan pembuatan paket. Lakukan smoke test pada Railway. Jangan anggap integrasi live lolos sebelum diverifikasi.
