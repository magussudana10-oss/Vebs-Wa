# SPEC RESMI — VEBS v2.6.0

## Tujuan
Menambahkan otomasi batch repayment/disbursement, konteks sementara grup, dan knowledge memory owner tanpa mengganti rumus KPI, alur AMCOLL, identitas owner, atau fitur analisis yang sudah ada di source aktif v2.5.0 tanggal 16 November 2026.

## Batch Manager
- Kategori repayment: Current/DPD 0, DPD 1–30, DPD 31–60, DPD 61–90.
- Kategori kelima: Disbursement, diambil dari Google Sheets read-only.
- Empat file repayment diterima satu per satu dalam chat yang sama.
- Klasifikasi file dari nama file/caption; kategori diverifikasi kembali dari isi workbook berdasarkan `dpd_old`.
- File wajib memiliki `loan_id`, `dpd_old`, `is_loan_restructured`, `payment_min_1x`.
- Setiap file harus berisi tepat satu bucket eligible; file campuran ditolak.
- Periode wajib dikenali dari nama file/caption. Scope menjadi bagian key batch. Cutoff pada `cutoff_bucket` harus konsisten dan tidak boleh campuran.
- Duplikasi kategori ditolak. Masa simpan sementara dua jam. Maksimal tiga batch aktif, 20 MB per file, 80 MB per batch.
- Setelah empat kategori valid, Disbursement dibaca; report baru dikirim setelah kelima kategori tersedia dan valid.

## Disbursement
- Spreadsheet ID default: `107Pnn4Rzm8bc9WuwVUhlmahNuzikyQX4xg8XbLPMi0w`.
- Tab default: `__DASH_INDEX`.
- Kolom wajib: `regional`, `point`, `loan_id`, `plafond`, `status_cair`.
- Scope: Regional Jawa Timur 5.
- NOA: hitung `loan_id` unik.
- Nominal: jumlah `plafond` untuk loan unik.
- Eksklusi: hanya status `Gagal Dicairkan`; status lainnya dihitung.
- Output: NOA dan nominal per Point, total Regional.
- Tidak ada target, gap, proyeksi, ranking, atau rekomendasi tambahan.

## Group Context
- Terpisah per group JID.
- Tidak membaca private chat sebagai shared context.
- TTL 30 menit; maksimum 100 pesan dan 18.000 karakter.
- Hanya digunakan sebagai konteks tambahan saat VEBS dipanggil; tidak mengubah trigger grup.
- Tidak disimpan sebagai shared context permanen.

## Owner Knowledge Memory
- File storage tetap `/data/vebs-memory.json` dan format history lama dipertahankan.
- Catatan knowledge ditulis hanya atas perintah owner terverifikasi (`MAGUS_OWNER_JID` exact match).
- Non-owner tidak dapat menambah, mengubah, atau menghapus memori; hanya catatan berstatus group_shared yang dapat dilihat.
- Perubahan catatan yang sudah ada memerlukan konfirmasi kedua dari owner.
- Tidak ada auto-save permanen dari pesan biasa.

## Kompatibilitas
- Node.js >=20.
- Dependensi runtime tetap sesuai v2.5.0.
- Railway Volume `/data` harus dipertahankan agar auth WhatsApp dan file memory tidak hilang.
