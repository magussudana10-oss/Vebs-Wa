# VEBS v2.5.0 – Intelligence & Document Analysis (BETA 1)

## Isi
- `server.js` — source server bot.
- `Code.gs` — Apps Script AMCOLL, disalin tanpa perubahan dari baseline yang diunggah.
- `package.json` — dependencies.
- `.env.example` — daftar environment variable tanpa secret.
- `TEST-PLAN.md` — checklist pengujian.
- `CHANGELOG.md` — ringkasan perubahan dan batasan.

## Yang ditambahkan pada beta ini
- Reply context untuk pesan yang mengutip media; memakai cache pesan masuk terbatas per chat atau `quotedMessage` dari WhatsApp.
- Analisis teks dari TXT/CSV.
- Ekstraksi teks DOCX menggunakan Mammoth.
- Ekstraksi teks PPTX dari XML slide.
- PDF dan gambar tetap memakai jalur analisis visual baseline.
- Pengiriman jawaban panjang dipecah menjadi beberapa pesan WhatsApp.
- Excel DPD/KPI, AMCOLL, memory, QR, Gemini fallback, owner security, dan trigger grup dipertahankan dari source baseline.

## Batasan penting beta
- **Video belum diimplementasikan.** Server hanya mendeteksi video dan memberi penjelasan. Ekstraksi frame FFmpeg dan audio/transkrip belum tersedia.
- Quoted media hanya dapat diproses jika metadata/isi media masih tersedia atau cache lokal masih menyimpannya. `syncFullHistory` tetap false; pesan lama yang tidak pernah diterima bot mungkin tidak dapat diambil.
- DOCX/PPTX diekstrak sebagai teks; layout kompleks, SmartArt, chart, animasi, dan sebagian objek tertanam mungkin tidak ikut terbaca.
- PDF memakai jalur Gemini inline yang sudah ada; belum ada OCR pipeline khusus/ekstraksi tabel PDF.
- PDF report visual Navy/White belum dibuat otomatis; jawaban panjang saat ini dikirim sebagai teks bertahap.
- Pemecahan pesan mencegah batas panjang WhatsApp, tetapi tidak dapat menjamin model menghasilkan analisis yang lengkap jika sumber melebihi batas konteks.

## Instalasi
1. Backup repository dan Apps Script terlebih dahulu.
2. Uji di branch/deployment terpisah.
3. Gunakan Node.js >=20.
4. Jalankan `npm install`, lalu `npm start`.
5. Pertahankan seluruh Railway variables dan volume `/data`. Jangan menghapus `/data/auth` atau `/data/vebs-memory.json`.
6. Jangan deploy produksi sebelum test plan lulus dan owner menyetujui.

## Konfigurasi
Pertahankan nilai existing. Jangan menimpa `MAGUS_OWNER_JID`, `AUTH_DIR`, `VEBS_MEMORY_PATH`, token, atau URL produksi dengan contoh kosong.


## v2.5.0 FINAL — batas fitur analisis

- Video Intelligence menggunakan FFmpeg untuk mengambil maksimal 8 frame berkala dari video berdurasi maksimal 180 detik dan ukuran maksimal 30 MB. VEBS menganalisis frame melalui Gemini. Audio diekstrak secara opsional sebagai input pendukung; bila tidak tersedia/gagal, analisis visual tetap berjalan. Kemampuan transkripsi/interpretasi audio bergantung pada dukungan model dan hasil aktual; jangan mengklaim audio terbaca jika tidak.
- Video hanya dianalisis. VEBS tidak membuat, mengedit, mengonversi, atau mengirim video hasil.
- Executive Analysis hanya menghasilkan jawaban analisis terstruktur di chat WhatsApp. Tidak ada pembuatan PDF, video laporan, atau file report otomatis.
- FFmpeg disediakan melalui dependency `ffmpeg-static`; tidak memerlukan command shell dari input pengguna. File sementara dibersihkan setelah proses.
- Batas video: 30 MB, 180 detik, maksimal 8 frame; audio maksimal 8 MB setelah ekstraksi.
- Fitur dokumen: PDF, DOCX, PPTX, TXT, CSV dan Excel mengikuti parser/batas yang tercantum di kode.

## Status validasi
Pemeriksaan sintaks `node --check server.js` dan validitas JSON `package.json` telah dila
Deployment trigger: VEBS v2.5.0kukan. Pengujian integrasi WhatsApp/Baileys, Gemini, FFmpeg di Railway, serta media real belum dijalankan pada environment produksi. Lakukan test plan di environment uji sebelum deploy.
