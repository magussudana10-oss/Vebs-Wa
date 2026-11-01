VEBS v2.5.0 FINAL — INTELLIGENCE & DOCUMENT ANALYSIS

Paket ini berisi source code final sesuai ruang lingkup analisis saja.

Fitur: reply media, PDF/DOCX/PPTX/TXT/CSV/Excel, gambar, video analysis-only dengan FFmpeg frame extraction dan audio opsional, serta pengiriman analisis panjang bertahap melalui WhatsApp.

Tidak ada pembuatan video, PDF report, atau file laporan otomatis.

Sebelum deploy: backup repository dan environment, pertahankan Railway Volume /data, AUTH_DIR, VEBS_MEMORY_PATH, MAGUS_OWNER_JID, serta konfigurasi AMCOLL. Jangan hapus sesi auth atau memory. Jalankan TEST-PLAN.md pada environment uji.

Status: syntax/JSON checks only; integrasi WhatsApp/Gemini/FFmpeg/Railway produksi belum diuji.
