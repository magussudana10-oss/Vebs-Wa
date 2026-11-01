# SPESIFIKASI RESMI PENGEMBANGAN
# VEBS v2.5.0 – INTELLIGENCE & DOCUMENT ANALYSIS

**Status:** Dokumen spesifikasi pengembangan resmi  
**Versi tujuan:** VEBS v2.5.0  
**Baseline yang wajib dipertahankan:** VEBS v2.4.3 – LIGHTNING RESPONSE  
**Jenis perubahan:** Penambahan kapabilitas dan penyempurnaan (additive upgrade)  
**Status implementasi:** Belum diimplementasikan / belum diuji pada produksi

---

## 1. Tujuan Pengembangan

Mengembangkan VEBS menjadi asisten WhatsApp yang mampu memahami dokumen, spreadsheet, gambar, screenshot, dan video secara lebih menyeluruh; memahami permintaan yang merujuk pada media yang dikirim sebelumnya melalui fitur reply; serta menghasilkan analisis terstruktur di WhatsApp yang dapat dikirim dalam beberapa bagian tanpa memotong isi. VEBS hanya menganalisis; tidak membuat video atau file laporan PDF.

Pengembangan v2.5.0 harus bersifat **additive**. Seluruh kemampuan, aturan bisnis, konfigurasi, dan perilaku yang sudah disetujui pada v2.4.3 tetap dipertahankan.

## 2. Prinsip Wajib: Jangan Merusak Baseline

Dilarang menghapus, mengganti, atau mengubah perilaku fitur baseline kecuali benar-benar diperlukan untuk integrasi fitur baru dan perubahan tersebut telah dijelaskan serta disetujui.

Hal-hal berikut wajib dipertahankan:

1. WhatsApp Baileys, QR login, reconnect, dan mekanisme autentikasi yang berjalan.
2. Gemini retry/fallback dan urutan model yang digunakan baseline:
   - Primary: `gemini-3.6-flash`
   - Fallback: `gemini-3.8-flash`
   - Fallback lanjutan: `gemini-3.5-flash-lite`
3. Persistent memory dan mekanisme penyimpanannya.
4. Excel DPD/KPI analysis serta filter scope Area/Branch/Point.
5. Aturan KPI:
   - Current / DPD 0: target 98%
   - DPD 1–30: target 55%
   - DPD 31–60: target 15%
   - DPD 61–90: target 7%
6. Perhitungan Paid berdasarkan `payment_min_1x=Yes`.
7. Pengecualian data restrukturisasi sesuai baseline.
8. Penggunaan bucket `dpd_old`.
9. Deduplication berdasarkan `loan_id`.
10. AMCOLL batch processing, FIFO, identity validation, anti-duplication/idempotency, validasi Source, dan penempatan destination kolom AD.
11. Aturan grup: respons grup tetap mengikuti trigger VEBS atau metadata mention yang sah. AMCOLL yang sudah dikecualikan dari syarat mention tetap berjalan sesuai baseline.
12. DM tetap dapat digunakan sesuai perilaku baseline.
13. Keamanan owner menggunakan exact JID `MAGUS_OWNER_JID`. Non-owner tidak boleh mengubah identitas bot, aturan sapaan, maupun aturan keamanan.
14. Gaya komunikasi natural, adaptif, dan WhatsApp-friendly.
15. Batasan dan perilaku baseline lain yang tidak disebutkan di dokumen ini.

**Penyimpanan dan konfigurasi sensitif tidak boleh diubah tanpa persetujuan eksplisit:**
- Auth/session path: `/data/auth`
- Memory path: `/data/vebs-memory.json`
- Railway Volume dan persistent storage
- `MAGUS_OWNER_JID`
- Struktur spreadsheet AMCOLL dan mapping kolom

Jangan menghapus volume, folder autentikasi, file memory, atau data produksi selama proses upgrade.

## 3. Fitur Baru v2.5.0

### 3.1 Document Intelligence – Multi-format

VEBS harus dapat mengenali dan memproses format berikut:

| Kategori | Format | Hasil yang diharapkan |
|---|---|---|
| PDF | `.pdf` | Ekstraksi teks dan analisis halaman/visual bila diperlukan |
| Word | `.docx` | Ekstraksi paragraf, heading, dan tabel |
| PowerPoint | `.pptx` | Ekstraksi isi slide, judul, teks, dan tabel |
| Excel | `.xlsx`, `.xls`, `.xlsm` | Analisis workbook, sheet, header, tabel, dan angka |
| Data teks | `.txt`, `.csv` | Ekstraksi teks dan analisis isi |
| Gambar | JPG, JPEG, PNG, WEBP dan format yang didukung | Analisis visual, teks pada gambar, tabel, grafik, dan screenshot |
| Video | Format video yang didukung Baileys dan pipeline | Analisis frame visual serta audio/transkrip jika tersedia |

Ketentuan:
- Pertahankan parser Excel khusus dan seluruh logika KPI yang sudah ada.
- Tambahkan parser untuk format yang belum didukung; jangan hanya mengubah prompt lalu mengklaim format telah didukung.
- Untuk dokumen kompleks, gabungkan ekstraksi teks dengan analisis visual bila diperlukan.
- Tampilkan peringatan bila sebagian konten tidak dapat diekstrak, file rusak, terenkripsi, terlalu besar, atau melewati batas pemrosesan.
- Jangan menyatakan telah membaca seluruh dokumen jika hanya sebagian halaman, sheet, slide, atau baris yang berhasil diproses.
- Catat jumlah halaman/slide/sheet/baris yang berhasil diproses bila dapat diketahui.

### 3.2 Reply Context & Media Retrieval

VEBS harus memahami instruksi yang dikirim sebagai balasan (reply) terhadap pesan yang berisi dokumen atau media.

Contoh alur grup:
1. Anggota A mengirim PDF, Excel, Word, PowerPoint, gambar, atau video.
2. Anggota B melakukan reply pada pesan tersebut.
3. Anggota B menulis `vebs` disertai instruksi, misalnya: “vebs, rangkum dokumen ini” atau “vebs, buat analisis tabelnya”.
4. VEBS mengambil media dari pesan yang direply dan memprosesnya, jika media tersebut masih tersedia.

Aturan:
- Berlaku untuk anggota grup mana pun; tidak dibatasi hanya pengirim media.
- Harus ada konteks reply yang mengarah ke pesan media dan trigger VEBS sesuai aturan grup.
- Di DM, reply terhadap media juga harus dapat diproses.
- Jangan mengambil media dari chat lain atau membocorkan isi percakapan lain.
- Utamakan `contextInfo.quotedMessage` dan/atau cache pesan masuk yang dibatasi dan terisolasi per chat.
- Pastikan key, participant, remoteJid, dan konteks pesan yang direkonstruksi sesuai dengan pesan asli sebelum mengunduh quoted media.
- Terapkan batas ukuran, validasi MIME/ekstensi, dan penanganan error.
- Jika quoted media sudah tidak tersedia, tidak tersinkron, kedaluwarsa, atau gagal diunduh, jelaskan keterbatasannya secara jujur dan baru minta pengguna mengirim ulang.
- Jangan meminta unggah ulang jika quoted media masih dapat diakses.

### 3.3 Visual & Video Intelligence

Untuk video, VEBS harus:
- Mengunduh video melalui mekanisme Baileys yang valid.
- Menggunakan FFmpeg untuk mengekstrak maksimal 8 frame berkala dari video yang memenuhi batas pemrosesan.
- Menganalisis gerakan, objek, adegan, teks visual, urutan kejadian, dan konteks yang terlihat pada frame.
- Mengekstrak audio secara opsional sebagai input pendukung analisis/transkrip bila pipeline dan model mendukungnya.
- Menggabungkan temuan visual dan audio bila keduanya benar-benar tersedia.
- Jika audio tidak tersedia atau gagal diproses, tetap berikan analisis visual dan nyatakan bahwa audio tidak dianalisis.
- Jangan mengarang isi audio, dialog, atau kejadian yang tidak terlihat.
- Hasil hanya berupa analisis teks di WhatsApp. VEBS tidak membuat, mengedit, atau mengirim video hasil.

Batas keamanan dan sumber daya:
- Tetapkan batas ukuran file, durasi, resolusi, jumlah frame, waktu proses, dan ukuran hasil transkrip.
- Validasi tipe file dan jangan menjalankan perintah shell dari input pengguna.
- Gunakan proses sementara yang aman dan hapus file sementara setelah selesai.
- Kegagalan ekstraksi audio tidak boleh menggagalkan analisis visual yang masih dapat dilakukan.

### 3.4 Executive Analysis Engine

VEBS menyusun hasil analisis secara profesional dan mudah dibaca langsung di WhatsApp.

Struktur default analisis:
1. Judul/topik analisis dan sumber data.
2. Ringkasan eksekutif.
3. KPI/angka utama atau total di bagian atas bila datanya tersedia.
4. Temuan utama.
5. Tabel teks atau daftar detail.
6. Risiko, anomali, atau catatan keterbatasan.
7. Kesimpulan dan rekomendasi/tindak lanjut bila diminta atau relevan.

Ketentuan output:
- Gunakan struktur yang bersih dan konsisten; gunakan label Navy/White hanya sebagai arahan gaya bila kelak ditampilkan dalam antarmuka yang mendukung warna.
- Di WhatsApp, gunakan teks, heading, bullet, dan tabel/daftar yang terbaca.
- Tidak membuat atau mengirim PDF, video laporan, gambar laporan, atau artefak laporan otomatis.
- Pemilihan tingkat detail dilakukan otomatis berdasarkan panjang, kompleksitas, dan instruksi pengguna.

Akurasi:
- Jangan membuat total, rata-rata, persentase, atau kesimpulan jika sumber data tidak mendukung.
- Tampilkan satuan, periode, dan basis perhitungan jika tersedia.
- Bedakan fakta dari estimasi dan rekomendasi.
- Sertakan catatan bila data tidak lengkap.

### 3.5 Long Response Delivery – Anti-Truncation

VEBS harus mengirim jawaban panjang secara bertahap tanpa memotong kalimat atau merusak struktur laporan.

Ketentuan:
- Pecah pesan berdasarkan paragraf, subjudul, atau batas baris tabel yang aman.
- Jangan memotong di tengah kalimat, item, atau baris tabel.
- Pertahankan urutan bagian dan nomor bagian.
- Gunakan antrean pengiriman per chat agar pesan tidak tertukar.
- Tambahkan jeda pengiriman yang wajar dan tangani kegagalan tiap bagian.
- Jika sebagian pengiriman gagal, laporkan bagian mana yang berhasil/gagal; jangan mengklaim seluruh laporan terkirim.
- Pastikan pemrosesan ulang tidak menggandakan pesan yang sudah berhasil dikirim.
- Untuk analisis yang melebihi kapasitas satu respons model, gunakan strategi pembagian analisis/sectioning; pemecahan pesan saja tidak cukup jika konten belum dihasilkan model.

### 3.6 Indonesia Local Intelligence

Tingkatkan kemampuan VEBS dalam memahami konteks geografis Indonesia dari Sabang sampai Merauke, termasuk:
- Provinsi, kabupaten/kota, kecamatan, kawasan, dan hubungan wilayah.
- Destinasi wisata, kuliner, cafe, tempat nongkrong, dan tempat relevan lainnya.
- Nama tempat harus ditulis spesifik dan lengkap bila dapat dipastikan.
- Berikan lokasi/kawasan, karakteristik tempat, dan informasi praktis yang relevan.
- Harga, jam buka, akses, dan informasi yang mudah berubah hanya boleh dinyatakan sebagai fakta jika tersedia dari sumber yang dapat dipercaya atau integrasi lookup yang benar-benar aktif.
- Jika tidak ada verifikasi terkini, nyatakan bahwa informasi tersebut perlu dikonfirmasi; jangan mengarang harga, jam buka, atau status operasional.
- Jangan mengklaim memiliki akses live web/Google Places jika integrasi tersebut belum benar-benar tersedia dan diuji.

### 3.7 Universal Table Intelligence

Jika pengguna meminta data atau teks diubah menjadi tabel:
- Identifikasi kolom yang sesuai dengan isi sumber.
- Pertahankan seluruh informasi penting dan urutan logis.
- Gunakan judul kolom yang jelas dan konsisten.
- Rapikan format tanggal, angka, mata uang, dan persentase tanpa mengubah nilai sumber.
- Jangan mengarang nilai yang kosong; tandai sebagai kosong/tidak tersedia.
- Untuk data panjang, berikan ringkasan di awal dan detail dalam bagian/tabel lanjutan.
- Analisis disajikan langsung sebagai teks WhatsApp; tidak membuat artefak PDF/video.

## 4. Pemilihan Output Otomatis

VEBS memilih bentuk jawaban berdasarkan kebutuhan:

| Kondisi | Output |
|---|---|
| Pertanyaan singkat atau satu temuan | Jawaban WhatsApp ringkas |
| Analisis beberapa poin | Ringkasan terstruktur di WhatsApp |
| Tabel kecil/sedang | Tabel/daftar teks WhatsApp yang terbaca |
| Dokumen atau dataset besar | Analisis terstruktur bertahap di WhatsApp saja |
| Video | Ringkasan visual dan audio/transkrip bila tersedia |
| Permintaan format khusus | Ikuti format yang diminta pengguna jika dapat dibuat |

Jangan membuat file kosong atau mengirim tautan/path yang tidak benar-benar tersedia.

## 5. Batasan Teknis, Keamanan, dan Privasi

1. Terapkan batas ukuran file dan batas pemrosesan per format.
2. Validasi MIME, ekstensi, dan struktur file; jangan mempercayai nama file saja.
3. Hindari path traversal, command injection, dan eksekusi konten dari dokumen.
4. Batasi cache pesan dan media; pisahkan berdasarkan chat; tentukan TTL dan batas memori.
5. Jangan menyimpan media pengguna secara permanen kecuali memang diperlukan dan disetujui.
6. Bersihkan file sementara setelah pemrosesan, termasuk saat terjadi error.
7. Jangan mengekspos token, API key, JID owner, isi memory, atau data chat lain.
8. Pertahankan validasi owner dan aturan keamanan baseline.
9. Jangan menonaktifkan retry/fallback, reconnect, atau persistent memory demi mengejar kecepatan.
10. Semua log harus menghindari pencatatan isi dokumen sensitif secara penuh.

## 6. Arsitektur Implementasi yang Disarankan

Implementasi dilakukan bertahap agar mudah diuji dan ditelusuri:

**Tahap 1 – Reply Context & Media Retrieval**
- Resolver pesan reply/quoted message.
- Cache pesan masuk terbatas dan terisolasi per chat bila dibutuhkan.
- Pengunduhan quoted media.
- Error handling untuk media tidak tersedia.

**Tahap 2 – Document Intelligence**
- TXT, DOCX, PPTX.
- Perkuat PDF.
- Pertahankan dan integrasikan parser Excel yang sudah ada.
- Status kelengkapan ekstraksi.

**Tahap 3 – Video Intelligence**
- Video download.
- Frame extraction.
- Audio extraction/transcription bila didukung.
- Batas durasi/ukuran dan cleanup.

**Tahap 4 – Executive Report & Long Response**
- Penyusunan analisis terstruktur di WhatsApp.
- Pengiriman bertahap, queue, idempotency, dan retry pengiriman.

**Tahap 5 – Indonesia Local & Universal Table Intelligence**
- Peningkatan prompt/knowledge yang realistis.
- Lookup terkini hanya jika integrasi disiapkan dan diuji.
- Normalisasi tabel universal.

**Tahap 6 – Regression Test dan rilis**
- Jalankan seluruh pengujian pada Bagian 7.
- Review diff terhadap v2.4.3.
- Siapkan rollback package.
- Rilis hanya setelah persetujuan owner.

Tahapan dapat disesuaikan secara teknis, tetapi seluruh hasil dan pengujian wajib terpenuhi.

## 7. Acceptance Criteria / Checklist Pengujian

### A. Baseline regression
- [ ] QR login dan reconnect berjalan.
- [ ] Session/auth tetap persisten setelah restart/deploy.
- [ ] Persistent memory tetap terbaca setelah restart.
- [ ] Gemini primary, fallback, retry berjalan.
- [ ] Excel KPI baseline menghasilkan angka yang sama dengan v2.4.3 pada dataset uji yang sama.
- [ ] Filter Area/Branch/Point tetap benar.
- [ ] `dpd_old`, `payment_min_1x=Yes`, restrukturisasi, dan dedup `loan_id` tetap benar.
- [ ] AMCOLL FIFO, validasi identitas, idempotency, Source, dan kolom AD tetap benar.
- [ ] Aturan grup, DM, mention, trigger, dan pengecualian AMCOLL tetap benar.
- [ ] Owner security tetap membatasi perubahan sensitif kepada `MAGUS_OWNER_JID`.

### B. Reply media
- [ ] Anggota A mengirim PDF; anggota B reply + `vebs`; VEBS menganalisis PDF.
- [ ] Anggota A mengirim Excel; anggota B reply + `vebs`; VEBS menganalisis Excel.
- [ ] Uji yang sama untuk DOCX, PPTX, TXT, CSV, gambar, dan video.
- [ ] Reply media dari pesan yang masih tersedia berhasil tanpa unggah ulang.
- [ ] Reply media kedaluwarsa/tidak tersedia menghasilkan penjelasan jujur dan instruksi unggah ulang.
- [ ] Media dari chat lain tidak pernah tertukar/terakses.

### C. Format dokumen
- [ ] PDF dengan teks.
- [ ] PDF hasil scan/gambar.
- [ ] DOCX dengan heading dan tabel.
- [ ] PPTX dengan banyak slide dan tabel.
- [ ] XLSX dengan banyak sheet.
- [ ] CSV/TXT dengan encoding yang relevan.
- [ ] File rusak, terenkripsi, terlalu besar, dan format tidak didukung ditangani dengan aman.
- [ ] Status kelengkapan ekstraksi ditampilkan.

### D. Video
- [ ] Video dengan gambar dan audio.
- [ ] Video tanpa audio.
- [ ] Video panjang/melebihi batas.
- [ ] Frame penting diringkas dengan urutan yang benar.
- [ ] Transkrip hanya ditampilkan jika benar-benar berhasil dibuat.
- [ ] File sementara dibersihkan.

### E. Output dan pengiriman
- [ ] Jawaban panjang tidak terpotong di tengah kalimat.
- [ ] Tabel tidak terpotong di tengah baris.
- [ ] Pesan terkirim sesuai urutan.
- [ ] Kegagalan pengiriman sebagian dilaporkan dengan benar.
- [ ] Tidak ada duplikasi saat retry.
- [ ] Tidak ada pembuatan PDF/video laporan; hasil analisis dikirim sebagai teks WhatsApp.
- [ ] Ringkasan KPI/total hanya muncul jika sumber mendukung.

### F. Keamanan dan stabilitas
- [ ] Cache memiliki TTL dan batas ukuran.
- [ ] Cache terisolasi per chat.
- [ ] Validasi file dan batas ukuran aktif.
- [ ] Tidak ada command injection/path traversal.
- [ ] Tidak ada kebocoran data lintas chat.
- [ ] Restart tidak menghapus auth/memory.
- [ ] Tidak ada perubahan tak disengaja pada konfigurasi produksi.

**Syarat rilis:** seluruh pengujian kritis A, B, E, dan F lulus. Pengujian format dan video harus lulus untuk format yang dinyatakan didukung. Kegagalan harus dicatat; fitur yang belum lulus tidak boleh diklaim siap.

## 8. Deliverables Wajib dari Pengembang

1. Source code lengkap yang telah diperbarui.
2. `package.json` lengkap dengan dependensi yang benar-benar digunakan.
3. README instalasi, konfigurasi, batasan, dan prosedur deployment.
4. File `.env.example` tanpa secret asli.
5. Test plan dan hasil pengujian.
6. Changelog v2.4.3 → v2.5.0.
7. Daftar file yang berubah dan alasan perubahan.
8. ZIP release lengkap.
9. Rollback package ke v2.4.3.
10. Konfirmasi eksplisit fitur yang sudah diuji vs yang belum diuji.

Jangan hanya mengirim prompt baru atau potongan kode. Implementasi harus berupa source code lengkap yang dapat diperiksa.

## 9. Ketentuan Deployment

- Jangan deploy otomatis ke produksi sebagai bagian dari proses coding.
- Jangan menghapus atau mengganti Railway Volume.
- Jangan menghapus `/data/auth` atau `/data/vebs-memory.json`.
- Jangan mengganti `MAGUS_OWNER_JID`.
- Jangan mengubah spreadsheet/schema AMCOLL.
- Lakukan backup source dan konfigurasi non-secret sebelum perubahan.
- Uji di lingkungan terpisah terlebih dahulu.
- Minta persetujuan owner sebelum deployment produksi.
- Setelah deploy, verifikasi QR/session persistence, memory, Gemini, group reply media, Excel KPI, AMCOLL, dan pengiriman analisis bertahap di WhatsApp.

## 10. Instruksi Resmi untuk Implementasi

Bangun **VEBS v2.5.0 – INTELLIGENCE & DOCUMENT ANALYSIS** berdasarkan source code VEBS v2.4.3 – LIGHTNING RESPONSE yang diberikan sebagai baseline.

Perlakukan seluruh fitur v2.5.0 pada dokumen ini sebagai penambahan atau penyempurnaan. Pertahankan seluruh fungsi baseline yang tidak secara eksplisit diubah. Sebelum mengedit, audit source code dan petakan lokasi integrasi. Implementasikan bertahap, buat pengujian regresi, dan laporkan keterbatasan nyata. Jangan mengklaim fitur telah berjalan sebelum pengujian membuktikannya.

**Prioritas pertama:** Reply Context & Media Retrieval, karena kemampuan analisis dokumen dari pesan yang direply bergantung pada akses quoted media yang benar.

**Status akhir yang diharapkan:** paket source code v2.5.0 lengkap, dokumentasi, test report, dan rollback package; belum boleh dianggap production-ready sampai acceptance criteria terpenuhi dan owner menyetujui rilis.
