# VEBS v2.4.0 — Test Plan

## A. Pemeriksaan statis
- [ ] `node --check server.js` berhasil.
- [ ] `package.json` valid dan `npm install` selesai tanpa error.
- [ ] Apps Script `Code.gs` tersimpan tanpa syntax error di editor Apps Script.
- [ ] Variable Railway lama tetap ada; `MAGUS_OWNER_JID` diisi dengan JID owner yang benar.
- [ ] Railway Volume `/data` tetap terpasang; sesi auth dan file memory tidak dihapus.

## B. WhatsApp dan pemicu grup
- [ ] DM teks biasa dijawab.
- [ ] Grup: pesan biasa tanpa panggilan tidak dijawab.
- [ ] Grup: `VEBS bantu...` dijawab.
- [ ] Grup: `Hai VEBS...` dijawab.
- [ ] Grup: mention aktual akun VEBS dijawab dengan respons penuh.
- [ ] Grup: teks `@VEBS` tanpa metadata mention tidak dianggap mention aktual.
- [ ] Pesan yang hanya mengutip kata VEBS di tengah obrolan tidak memicu bot.
- [ ] AMCOLL batch tetap diproses di grup tanpa mention.
- [ ] Pesan duplikat tidak diproses dua kali.

## C. Media
- [ ] DM foto/receipt/screenshot dianalisis.
- [ ] Grup foto tanpa pemanggilan diabaikan.
- [ ] Grup foto dengan panggilan VEBS atau mention aktual dianalisis.
- [ ] PDF di DM dianalisis.
- [ ] PDF di grup tanpa panggilan diabaikan; dengan panggilan diproses.
- [ ] File kosong, rusak, atau lebih dari 18 MB ditolak dengan pesan yang wajar.
- [ ] Angka/teks yang tidak terbaca tidak ditebak oleh VEBS.

## D. Excel DPD/KPI — regression wajib
- [ ] File `.xlsx`, `.xls`, dan `.csv` valid dapat dianalisis.
- [ ] Target tetap Current 98%, DPD 1–30 55%, DPD 31–60 15%, DPD 61–90 7%.
- [ ] Bucket tetap memakai `dpd_old`.
- [ ] Restruktur tetap dikecualikan.
- [ ] Paid tetap berdasarkan `payment_min_1x=Yes`.
- [ ] Deduplikasi `loan_id` tetap sesuai implementasi sumber.
- [ ] Permintaan Area/Branch/Point tertentu hanya menampilkan scope yang diminta.
- [ ] Scope yang tidak ditemukan tidak menyebabkan seluruh data ditampilkan.
- [ ] Permintaan ringkasan tidak membocorkan seluruh dataset.

## E. AMCOLL — regression wajib di spreadsheet uji
- [ ] Satu laporan valid menambah satu baris dengan nominal di AD.
- [ ] Batch beberapa laporan valid diproses berurutan (FIFO) dalam satu request.
- [ ] Format WhatsApp `123456/50000` berhasil tanpa nama/customer number pada pesan.
- [ ] Identitas customer dan customer number otomatis diambil dari Source berdasarkan Loan ID.
- [ ] Loan ID tidak ditemukan ditolak tanpa append.
- [ ] Loan ID yang muncul lebih dari satu kali di Source ditolak sebagai ambigu tanpa append.
- [ ] Request kompatibilitas lama yang menyertakan nama/customer number tetap divalidasi ketat.
- [ ] Identitas dan nominal sama ditolak sebagai duplikat.
- [ ] Nominal berbeda untuk Customer Number + Loan ID yang sama diterima sesuai aturan baseline (dibandingkan dengan laporan terakhir).
- [ ] Input `123456/50.000` dan `123456/50000` sama-sama mencatat angka 50000, bukan 50.
- [ ] Retry message ID yang sama tidak menulis dua kali.
- [ ] Dua batch dari chat berbeda tidak menginterleave (LockService).
- [ ] Endpoint timeout/error tidak menghasilkan konfirmasi sukses.
- [ ] Nilai baris tujuan diverifikasi sebelum VEBS menyatakan berhasil.

## F. Memory, owner, deployment
- [ ] Histori chat tetap tersimpan di `/data/vebs-memory.json` setelah restart.
- [ ] Histori antar pengirim grup tetap terpisah.
- [ ] Owner JID cocok: ditandai owner pada konteks sistem.
- [ ] Non-owner tidak dapat mengubah aturan sapaan/identitas melalui instruksi chat.
- [ ] JID owner kosong/salah: otorisasi owner gagal aman.
- [ ] QR/session WhatsApp tetap tersambung setelah redeploy tanpa menghapus auth.
- [ ] `/health` dan `/status` merespons normal.

**Go-live hanya setelah semua pengujian kritis D dan E lulus pada salinan spreadsheet/lingkungan uji.**
