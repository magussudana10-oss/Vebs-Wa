# VEBS v2.5.0 beta.1 – Test Plan

## Static checks
- [ ] `node --check server.js`
- [ ] `npm install` on Node.js >=20
- [ ] Verify Code.gs syntax in Apps Script editor (unchanged baseline)
- [ ] Confirm all Railway secrets and `/data` volume remain unchanged

## Regression baseline
- [ ] QR login/reconnect and session persistence
- [ ] Persistent memory survives restart
- [ ] Gemini primary/fallback behavior
- [ ] Excel `.xlsx`, `.xls`, `.xlsm`, `.csv` analysis
- [ ] KPI targets and formulas match baseline exactly
- [ ] Area/Branch/Point scope filtering
- [ ] AMCOLL single and batch, FIFO, idempotency, Source validation, destination AD
- [ ] Group trigger anywhere, actual mention, AMCOLL exemption
- [ ] Owner authorization exact JID

## New document handling
- [ ] TXT UTF-8 and CSV extraction
- [ ] DOCX paragraphs and tables
- [ ] PPTX multiple slides and slide ordering
- [ ] PDF text-based and scanned PDF behavior
- [ ] Image screenshot/photo analysis
- [ ] File >18 MB, corrupt, encrypted and unsupported format handling
- [ ] Verify extraction truncation notice at 80,000 characters

## Reply context
- [ ] Group: member A sends document; member B replies with "vebs" + instruction
- [ ] Group: reply to photo/PDF/Excel by another sender
- [ ] DM: reply to media + VEBS instruction
- [ ] Quoted media from cache vs contextInfo-only reconstruction
- [ ] Historical/expired media fails gracefully and asks for re-upload only after access fails
- [ ] Ensure cache keys are chat-scoped and no cross-chat retrieval occurs

## Long delivery
- [ ] Long answer splits into sequential messages
- [ ] Paragraph/table rows are not split mid-line where possible
- [ ] Simulate send failure and ensure no false success claim
- [ ] Ensure repeated processing does not duplicate output

## Not implemented in beta.1
- [ ] Video frame extraction (FFmpeg)
- [ ] Audio extraction/transcription
- [ ] Automated Navy/White PDF report generation

**Release gate:** Do not deploy production until all critical regression tests pass. Beta.1 is not feature-complete for the full v2.5.0 specification.


## Tambahan pengujian v2.5.0 Intelligence & Document Analysis

### Dokumen dan reply media
- [ ] Reply + trigger VEBS pada PDF/DOCX/PPTX/TXT/CSV dari anggota lain dalam grup; pastikan pesan quoted yang tepat diproses.
- [ ] Uji quoted media yang tidak ada di cache/expired; VEBS harus menjelaskan kegagalan dan meminta unggah ulang hanya bila perlu.
- [ ] Pastikan media lintas chat tidak pernah tertukar.
- [ ] Uji dokumen besar/rusak/terenkripsi dan verifikasi catatan batas ekstraksi.

### Video analysis-only
- [ ] Video MP4 dengan visual dan audio: maksimal 8 frame dianalisis, audio hanya dipakai bila ekstraksi berhasil.
- [ ] Video tanpa audio: analisis visual tetap berjalan dan menyatakan audio tidak tersedia.
- [ ] Video lebih dari 30 MB atau 180 detik ditolak dengan pesan yang jelas.
- [ ] Video tanpa frame valid ditangani sebagai gagal, tidak mengarang hasil.
- [ ] Pastikan file sementara dibersihkan setelah sukses maupun error.
- [ ] Pastikan VEBS hanya mengirim analisis teks di WhatsApp; tidak membuat video atau PDF laporan.

### Long response dan baseline
- [ ] Jawaban panjang dikirim per bagian tanpa memotong kalimat/baris.
- [ ] Regression test seluruh Excel DPD/KPI, AMCOLL, memory, QR/reconnect, trigger grup, dan owner security.
