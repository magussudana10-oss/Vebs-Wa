/**
 * VEBS Auto Collection AMCOLL — Google Apps Script endpoint
 * Spreadsheet: 1sMgVMQAhEomc1tOjmJ1cypYeWJKB7QEAiNFpZNiCD0U
 * Required Script Property: VEBS_API_TOKEN (must match Railway AMCOLL_API_TOKEN)
 * Deploy as Web app, execute as owner, access as anyone; endpoint is protected by the token.
 */
const SPREADSHEET_ID = '1sMgVMQAhEomc1tOjmJ1cypYeWJKB7QEAiNFpZNiCD0U';
const SOURCE_SHEET_NAME = 'Source';
const DEST_SHEET_NAME = 'Data Collection Amcoll';
const AMOUNT_COLUMN = 30; // AD

function doGet() {
  return json_({ ok: true, service: 'VEBS Auto Collection AMCOLL', message: 'Endpoint aktif. Gunakan POST untuk laporan.' });
}

function doPost(e) {
  let lock;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('VEBS_API_TOKEN');
    if (!expected || !body.token || !constantTimeEqual_(String(body.token), String(expected))) {
      return json_({ ok: false, code: 'UNAUTHORIZED', message: 'Token tidak valid.' });
    }
    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    // Batch endpoint used by VEBS. Keep LockService around the entire batch so
    // reports from different chats cannot interleave; recordReport_ remains the
    // single-report validator/writer and preserves legacy request compatibility.
    if (Array.isArray(body.reports)) {
      const results = body.reports.map(function(report) {
        return recordReport_(report || {});
      });
      return json_({ ok: results.every(function(item) { return item && item.ok; }), results: results });
    }
    const result = recordReport_(body);
    return json_(result);
  } catch (err) {
    console.error('AMCOLL doPost error: ' + (err && err.stack ? err.stack : err));
    return json_({ ok: false, code: 'ERROR', message: 'Spreadsheet gagal memproses laporan. Tidak ada konfirmasi berhasil.' });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function recordReport_(body) {
  const suppliedName = clean_(body.customer_name);
  const suppliedNumber = clean_(body.customer_number);
  const loanId = clean_(body.loan_id);
  const amount = parseAmount_(body.nominal_bayar !== undefined ? body.nominal_bayar : body.nominal_bayar_value);
  if (!loanId || amount === null || amount <= 0) {
    return { ok: false, code: 'INVALID_IDENTITY', mismatches: [{ field: 'laporan', message: 'Loan ID kosong atau nominal tidak valid.' }] };
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const source = ss.getSheetByName(SOURCE_SHEET_NAME);
  const dest = ss.getSheetByName(DEST_SHEET_NAME);
  if (!source || !dest) return { ok: false, code: 'ERROR', message: 'Sheet Source atau Data Collection Amcoll tidak ditemukan.' };
  if (source.getLastRow() < 2) return { ok: false, code: 'ERROR', message: 'Data Source belum tersedia.' };

  const sourceHeaders = source.getRange(1, 1, 1, source.getLastColumn()).getDisplayValues()[0];
  const sourceIndex = headerMap_(sourceHeaders);
  const required = ['customer_name', 'customer_number', 'loan_id'];
  const missingHeaders = required.filter(k => sourceIndex[k] === undefined);
  if (missingHeaders.length) return { ok: false, code: 'ERROR', message: 'Kolom Source tidak lengkap: ' + missingHeaders.join(', ') };

  const destHeaders = dest.getRange(1, 1, 1, Math.max(dest.getLastColumn(), AMOUNT_COLUMN)).getDisplayValues()[0];
  const destIndex = headerMap_(destHeaders);
  if (normalizeHeader_(destHeaders[AMOUNT_COLUMN - 1]) !== 'nominalbayar') {
    return { ok: false, code: 'ERROR', message: 'Header kolom AD harus bernama nominal bayar. Tidak ada data yang ditulis.' };
  }
  const destRequired = required.filter(k => destIndex[k] === undefined);
  if (destRequired.length) return { ok: false, code: 'ERROR', message: 'Kolom identitas pada Data Collection Amcoll tidak lengkap: ' + destRequired.join(', ') };

  // Format WhatsApp tetap LoanID/Nominal. Identitas customer diambil dari
  // Source berdasarkan Loan ID, bukan diminta dari pengirim atau ditebak.
  const sourceValues = source.getRange(2, 1, source.getLastRow() - 1, source.getLastColumn()).getValues();
  const loanMatches = [];
  for (let i = 0; i < sourceValues.length; i++) {
    const row = sourceValues[i];
    if (cleanIdentifier_(row[sourceIndex.loan_id]) === cleanIdentifier_(loanId)) {
      loanMatches.push({ rowNumber: i + 2, values: row });
    }
  }
  if (loanMatches.length === 0) {
    return { ok: false, code: 'INVALID_IDENTITY', mismatches: [{ field: 'loan_id', message: 'tidak ditemukan di Source' }] };
  }
  if (loanMatches.length > 1) {
    return { ok: false, code: 'AMBIGUOUS', message: 'Loan ID cocok dengan lebih dari satu baris Source. Tidak ada data yang ditulis.' };
  }

  const matched = loanMatches[0];
  const customerName = clean_(matched.values[sourceIndex.customer_name]);
  const customerNumber = clean_(matched.values[sourceIndex.customer_number]);
  if (!customerName || !customerNumber) {
    return { ok: false, code: 'INVALID_IDENTITY', mismatches: [{ field: 'identity', message: 'Nama customer atau customer number pada Source kosong.' }] };
  }
  // Backward compatibility: bila caller lama mengirim identitas, tetap
  // validasi ketat terhadap Source. Caller baru cukup mengirim Loan ID.
  if (suppliedName && normalizeIdentity_(suppliedName) !== normalizeIdentity_(customerName)) {
    return { ok: false, code: 'INVALID_IDENTITY', mismatches: [{ field: 'customer_name', message: 'tidak cocok dengan Source' }] };
  }
  if (suppliedNumber && cleanIdentifier_(suppliedNumber) !== cleanIdentifier_(customerNumber)) {
    return { ok: false, code: 'INVALID_IDENTITY', mismatches: [{ field: 'customer_number', message: 'tidak cocok dengan Source' }] };
  }

  // Idempotency by WhatsApp message id: retries of the same event do not append twice.
  const reportId = clean_(body.whatsapp_message_id);
  const lastRow = Math.max(dest.getLastRow(), 1);
  const destWidth = Math.max(dest.getLastColumn(), AMOUNT_COLUMN);
  const existingRows = lastRow >= 2 ? dest.getRange(2, 1, lastRow - 1, destWidth).getValues() : [];
  const amountNotes = lastRow >= 2 ? dest.getRange(2, AMOUNT_COLUMN, lastRow - 1, 1).getNotes() : [];
  let latestSameLoan = null;
  for (let i = 0; i < existingRows.length; i++) {
    const row = existingRows[i];
    const existingNumber = cleanIdentifier_(row[destIndex.customer_number]);
    const existingLoan = cleanIdentifier_(row[destIndex.loan_id]);
    const existingAmount = toAmount_(row[AMOUNT_COLUMN - 1]);
    const existingReportId = destIndex.whatsappmessageid === undefined ? '' : clean_(row[destIndex.whatsappmessageid]);
    const note = amountNotes[i] && amountNotes[i][0] ? String(amountNotes[i][0]) : '';
    if (reportId && ((existingReportId && reportId === existingReportId) || note.includes('VEBS_MESSAGE_ID=' + reportId))) {
      return { ok: false, code: 'DUPLICATE', row: i + 2, message: 'Pesan WhatsApp ini sudah pernah direkap.' };
    }
    if (existingNumber === cleanIdentifier_(customerNumber) && existingLoan === cleanIdentifier_(loanId) && existingAmount !== null) {
      // Pertahankan kebijakan baseline: bandingkan dengan laporan terbaru
      // untuk customer + loan yang sama.
      latestSameLoan = { row: i + 2, amount: existingAmount };
    }
  }
  if (latestSameLoan && Math.abs(latestSameLoan.amount - amount) < 0.000001) {
    return { ok: false, code: 'DUPLICATE', row: latestSameLoan.row, message: 'Nominal sama dengan laporan terbaru untuk pinjaman ini.' };
  }

  // Strict append: A:AC dari Source dan nominal bayar di AD.
  const nextRow = Math.max(dest.getLastRow() + 1, 2);
  const sourceWidth = Math.min(29, source.getLastColumn());
  const rowValues = new Array(AMOUNT_COLUMN).fill('');
  for (let c = 0; c < sourceWidth; c++) rowValues[c] = matched.values[c] === undefined ? '' : matched.values[c];
  rowValues[AMOUNT_COLUMN - 1] = amount;
  if (destIndex.whatsappmessageid !== undefined && destIndex.whatsappmessageid < AMOUNT_COLUMN - 1) {
    rowValues[destIndex.whatsappmessageid] = reportId;
  }
  dest.getRange(nextRow, 1, 1, AMOUNT_COLUMN).setValues([rowValues]);
  if (reportId) dest.getRange(nextRow, AMOUNT_COLUMN).setNote('VEBS_MESSAGE_ID=' + reportId);
  SpreadsheetApp.flush();

  const verify = dest.getRange(nextRow, 1, 1, AMOUNT_COLUMN).getValues()[0];
  if (toAmount_(verify[AMOUNT_COLUMN - 1]) === null || Math.abs(toAmount_(verify[AMOUNT_COLUMN - 1]) - amount) >= 0.000001) {
    return { ok: false, code: 'ERROR', message: 'Verifikasi penulisan nominal gagal.' };
  }
  return { ok: true, code: 'SUCCESS', row: nextRow, receivedAt: clean_(body.received_at),
    customer_name: customerName, customer_number: customerNumber, loan_id: loanId, nominal_bayar: amount };
}

function parseAmount_(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  let raw = clean_(value).replace(/rp\.?/gi, '').replace(/\s/g, '');
  if (!raw || !/^[+]?[\d.,]+$/.test(raw)) return null;
  if (raw.indexOf('.') >= 0 && raw.indexOf(',') >= 0) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    raw = raw.replace(/\./g, '');
  } else if (raw.indexOf(',') >= 0) {
    const parts = raw.split(',');
    raw = parts.length === 2 && parts[1].length <= 2 ? parts[0].replace(/\./g, '') + '.' + parts[1] : raw.replace(/,/g, '');
  }
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function headerMap_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const key = normalizeHeader_(h);
    if (key === 'customername') map.customer_name = i;
    else if (key === 'customernumber') map.customer_number = i;
    else if (key === 'loanid') map.loan_id = i;
    else if (key === 'nominalbayar') map.nominal_bayar = i;
    else if (key === 'whatsappmessageid') map.whatsappmessageid = i;
  });
  return map;
}
function normalizeHeader_(value) { return String(value == null ? '' : value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalizeIdentity_(value) { return String(value == null ? '' : value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID'); }
function clean_(value) { return String(value == null ? '' : value).normalize('NFKC').trim().replace(/\s+/g, ' '); }
function cleanIdentifier_(value) { return clean_(value).replace(/\.0$/, '').replace(/\s/g, '').toLowerCase(); }
function toAmount_(value) { if (value === '' || value == null) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function constantTimeEqual_(a, b) { if (a.length !== b.length) return false; let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0; }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
