# VEBS v2.5.0 — Deployment package

- Menggabungkan source server v2.5.0 yang disediakan untuk deployment.
- Mempertahankan jalur Excel DPD/KPI, AMCOLL, memory persisten, QR/Baileys, Gemini fallback, dokumen, dan analisis media sesuai source paket.
- Menerapkan Lightning Completion: batas output mode LIGHTNING dinaikkan dari 320 menjadi 800 token; prompt meminta kalimat utuh; `finishReason` dicatat; jika `MAX_TOKENS`, model diminta melanjutkan maksimal dua kali.
- Tidak mengubah Railway Variables atau data volume.

Catatan: syntax check bukan pengujian integrasi live. Verifikasi menggunakan TEST-PLAN.md.
