VEBS v2.5.0 — FULL DEPLOYMENT PACKAGE

ISI PAKET
- server.js: source server VEBS dengan patch Lightning Completion.
- package.json: dependency yang sesuai dengan import server.js.
- Code.gs: endpoint Google Apps Script AMCOLL.
- .env.example: contoh nama variable tanpa secret.
- README.md, SPEC-RESMI-VEBS-v2.5.0.md, TEST-PLAN.md, CHANGELOG*.md: dokumentasi.

PENTING SEBELUM UPLOAD
1. Paket ini tidak berisi API key, token, kredensial WhatsApp, folder auth, atau file memory.
2. Backup repository GitHub dan Code.gs Apps Script terlebih dahulu.
3. Ekstrak ZIP. Upload/replace file di root repository GitHub branch main.
4. Replace server.js dan package.json dari paket ini. Upload dokumen jika diinginkan.
5. Jika repository memiliki package-lock.json lama, jangan gunakan lock lama bersama package.json baru. Hapus package-lock.json lama dari repository agar Railpack/npm membuat lock yang sesuai saat instalasi, atau buat lock baru dengan `npm install` secara lokal lalu commit package-lock.json yang baru.
6. Jangan upload .env.example sebagai .env. Jangan memasukkan secret ke GitHub.
7. Commit perubahan ke branch main. Railway Auto Deploy akan memulai deployment baru.

RAILWAY — JANGAN DIUBAH
- Pertahankan semua Environment Variables produksi yang sudah ada.
- Pertahankan Railway Volume yang ter-mount di /data.
- Pertahankan AUTH_DIR=/data/auth dan VEBS_MEMORY_PATH=/data/vebs-memory.json sesuai konfigurasi produksi saat ini.
- Jangan hapus /data/auth atau /data/vebs-memory.json.
- Jangan scan QR ulang jika WhatsApp masih connected.
- Jangan hapus deployment ACTIVE lama sampai deployment baru berhasil dan sudah diuji.

GOOGLE APPS SCRIPT
Code.gs disertakan sebagai salinan source AMCOLL. Jangan mengganti/deploy ulang Apps Script jika tidak ada perubahan AMCOLL yang memang diperlukan. Jika perlu memasangnya, backup Code.gs lama, pertahankan Script Property VEBS_API_TOKEN, dan pastikan nilainya tetap sama dengan AMCOLL_API_TOKEN di Railway.

VALIDASI
Paket disiapkan dari source yang tersedia dan pemeriksaan sintaks Node.js serta validitas JSON dilakukan. Ini bukan bukti pengujian live di Railway, Gemini, WhatsApp, atau spreadsheet produksi. Ikuti TEST-PLAN.md setelah deployment.
