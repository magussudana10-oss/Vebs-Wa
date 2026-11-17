# VEBS v2.6.0 — Test Plan

## Automated tests
- [x] Detect Current/DPD 0, DPD 1–30, DPD 31–60, DPD 61–90 and Disbursement labels.
- [x] Parse period and scope keys to separate batches.
- [x] Disbursement: deduplicate `loan_id`.
- [x] Disbursement: exclude `Gagal Dicairkan` and include `Sudah Cair` / `Menunggu Pencairan`.
- [x] Disbursement: sum `plafond` per Point and Regional total.
- [x] Owner memory command parser: save/update-confirm/cancel.
- [x] Group context isolation across group JIDs.
- [x] `node --check server.js`.
- [x] package.json parse.

## Manual staging checks still required
- [ ] Send four real repayment category workbooks; confirm invalid/mixed bucket files are rejected.
- [ ] Confirm same-period/cutoff/scope validation with actual source workbooks.
- [ ] Confirm public Google Sheets CSV endpoint returns the `__DASH_INDEX` tab from Railway.
- [ ] Confirm the Disbursement result against the source sheet: unique `loan_id`, sum `plafond`, exclude only `Gagal Dicairkan`.
- [ ] Confirm Group Context shared only inside one group, expires after 30 minutes, and never imports private-chat history.
- [ ] Confirm non-owner cannot save/update/delete owner memory; exact owner JID can.
- [ ] Confirm existing `/data/vebs-memory.json` histories remain readable after v2.6.0 restart.
- [ ] AMCOLL regression: existing submission, FIFO, idempotency and Apps Script behavior.
- [ ] WhatsApp reconnect and QR/session persistence on the existing Railway Volume.

Do not treat the manual staging list as passed until tested on the actual Railway deployment.
