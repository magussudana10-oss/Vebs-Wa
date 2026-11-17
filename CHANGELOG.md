# VEBS v2.6.0 — Changelog

## Integrated upgrade
- Added temporary per-group shared context (30-minute TTL, bounded message/character capacity); isolated by group JID.
- Added owner-controlled persistent knowledge memory with exact `MAGUS_OWNER_JID` authorization and explicit confirmation for updates.
- Added automatic four-file repayment batch intake, category/content validation, period/scope/cutoff separation, duplicate rejection, and automatic Disbursement snapshot retrieval.
- Added read-only Google Sheets Disbursement recap by Point and Regional Jatim 5; unique `loan_id`, sum `plafond`, exclude only `Gagal Dicairkan`.
- Preserved the existing v2.5.0 server capabilities and restored the latest WhatsApp sender-profile resolver.
- Added built-in Node test suite and Railway deployment/rollback notes.

## Verification notes
- Syntax check: passed.
- Unit tests: 5 passed.
- Package JSON parse: passed.
- ZIP integrity: checked at packaging.
- Live Google Sheets, WhatsApp and Railway integration: not testable from this environment; run smoke tests after deploy.
