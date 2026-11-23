import { createHash, randomUUID } from "node:crypto";

const TARGET_TAB = "Sheet1";
const CHUNK_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 120000;
const REQUIRED_HEADERS = [
  "region_name", "area_name", "branch_name", "loan_id", "customer_number",
  "dpd_old", "is_loan_restructured", "payment_min_1x"
];

function normalizeHeader(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeRegional(value) {
  return normalizeHeader(value).replace(/_/g, "");
}

function isJatim5(value) {
  return ["jawatimur5", "jatim5", "regionaljawatimur5"].includes(normalizeRegional(value));
}

function toSheetValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    // Google Sheets date serial; existing target formatting displays the date.
    return value.getTime() / 86400000 + 25569;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  return value;
}

function readCurrentSheet(XLSX, buffer, detectOnly = false) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
  } catch (error) {
    if (detectOnly) return { isCurrent: false };
    throw new Error(`Workbook Current tidak dapat dibaca: ${error?.message || String(error)}`);
  }

  const sheet = workbook.Sheets[TARGET_TAB];
  if (!sheet) return detectOnly ? { isCurrent: false } : (() => { throw new Error(`Sheet sumber '${TARGET_TAB}' tidak ditemukan.`); })();

  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1, defval: null, raw: true, blankrows: false
  });
  if (!matrix.length) return detectOnly ? { isCurrent: false } : (() => { throw new Error("Sheet1 pada file Current kosong."); })();

  const headers = matrix[0].map(value => String(value ?? "").trim());
  const positions = new Map();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized && !positions.has(normalized)) positions.set(normalized, index);
  });
  const requiredPresent = REQUIRED_HEADERS.every(header => positions.has(header));
  const isSignature = headers.length === 37 && requiredPresent && positions.has("cutoff_bucket") && positions.has("loan_state");
  if (!isSignature) {
    return detectOnly ? { isCurrent: false } : (() => { throw new Error("Struktur DPD Current tidak cocok. File harus memakai header Current Jatim 5 dengan 37 kolom di Sheet1."); })();
  }
  if (detectOnly) return { isCurrent: true, sheetName: TARGET_TAB, columns: headers.length };

  const regionIndex = positions.get("region_name");
  const dpdIndex = positions.get("dpd_old");
  const loanIndex = positions.get("loan_id");
  const rows = [];
  let sourceRows = 0;
  let duplicateLoanIds = 0;
  const seenLoanIds = new Set();

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex++) {
    const source = matrix[rowIndex];
    if (!source || source.every(value => value === null || value === "")) continue;
    sourceRows++;
    if (!isJatim5(source[regionIndex])) {
      throw new Error(`Baris ${rowIndex + 1} bukan Regional Jawa Timur 5. Upload dibatalkan agar data regional lain tidak masuk.`);
    }
    const dpd = Number(source[dpdIndex]);
    if (source[dpdIndex] === null || source[dpdIndex] === "" || !Number.isFinite(dpd) || dpd !== 0) {
      throw new Error(`Baris ${rowIndex + 1} memiliki dpd_old kosong atau bukan 0. File bukan snapshot DPD Current murni.`);
    }
    const loanId = String(source[loanIndex] ?? "").trim();
    if (!loanId) throw new Error(`loan_id kosong pada baris sumber ${rowIndex + 1}. Upload dibatalkan.`);
    if (seenLoanIds.has(loanId)) duplicateLoanIds++;
    else seenLoanIds.add(loanId);

    const row = Array.from({ length: headers.length }, (_, columnIndex) => toSheetValue(source[columnIndex]));
    rows.push(row);
  }

  if (!sourceRows || !rows.length) throw new Error("Tidak ditemukan data Regional Jawa Timur 5 pada file Current.");
  return {
    isCurrent: true,
    sheetName: TARGET_TAB,
    headers,
    rows,
    totalRows: rows.length,
    duplicateLoanIds
  };
}

export function detectCurrentWorkbook(XLSX, buffer, options = {}) {
  return readCurrentSheet(XLSX, buffer, Boolean(options.detectOnly));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function postJson(url, payload, token) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ token, ...payload }),
        signal: controller.signal,
        redirect: "follow"
      });
      const bodyText = await response.text();
      let body;
      try { body = JSON.parse(bodyText); }
      catch {
        if (response.status >= 500 && attempt < 3) {
          lastError = new Error(`Apps Script HTTP ${response.status}; retry ${attempt}/3.`);
          continue;
        }
        throw new Error(`Apps Script tidak mengembalikan JSON (HTTP ${response.status}). Periksa akses Web App dan deployment.`);
      }
      if (response.status >= 500 && attempt < 3) {
        lastError = new Error(body?.message || `Apps Script HTTP ${response.status}.`);
        continue;
      }
      if (!response.ok || body?.success !== true) {
        const error = new Error(body?.message || body?.error || `Apps Script gagal (HTTP ${response.status}).`);
        error.noRetry = true;
        throw error;
      }
      return body.result || {};
    } catch (error) {
      if (error?.name === "AbortError") lastError = new Error("Koneksi Apps Script timeout setelah 120 detik.");
      else lastError = error;
      if (error?.noRetry || attempt >= 3) throw lastError;
      // Begin/chunk/commit are idempotent by upload ID and chunk hash.
    } finally {
      clearTimeout(timer);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 1500));
  }
  throw lastError || new Error("Apps Script gagal setelah percobaan ulang.");
}

export async function uploadCurrentRows({ url, token, parsed, fileName }) {
  if (!url || !token) throw new Error("Integrasi Current belum dikonfigurasi. Periksa CURRENT_WEBAPP_URL dan CURRENT_API_TOKEN di Railway.");
  if (!parsed?.headers?.length || !parsed?.rows?.length) throw new Error("Data Current untuk upload kosong.");

  const uploadId = randomUUID();
  const chunks = Math.ceil(parsed.rows.length / CHUNK_SIZE);
  const begin = await postJson(url, {
    action: "current_begin",
    uploadId,
    fileName: String(fileName || "Current Jatim 5.xlsx").slice(0, 180),
    targetTab: TARGET_TAB,
    headers: parsed.headers,
    expectedRows: parsed.rows.length,
    expectedChunks: chunks
  }, token);

  if (begin.mode !== "FULL_REPLACE_DIRECT" || begin.directWrite !== true || begin.targetTab !== TARGET_TAB) {
    throw new Error("Apps Script mengembalikan konfigurasi target yang tidak sesuai. Upload dihentikan.");
  }

  let uploadedRows = 0;
  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
    const rows = parsed.rows.slice(chunkIndex * CHUNK_SIZE, (chunkIndex + 1) * CHUNK_SIZE);
    const chunkHash = sha256(rows);
    const result = await postJson(url, {
      action: "current_chunk",
      uploadId,
      chunkIndex,
      chunkHash,
      rows
    }, token);
    uploadedRows += rows.length;
    if (result.writtenRows !== uploadedRows) {
      throw new Error(`Jumlah baris Sheet1 tidak sesuai pada chunk ${chunkIndex + 1}. Expected ${uploadedRows}, received ${result.writtenRows}.`);
    }
    if ((chunkIndex + 1) % 10 === 0 || chunkIndex + 1 === chunks) {
      console.log(`[CURRENT UPLOAD] direct Sheet1 write ${uploadedRows}/${parsed.rows.length} rows (${chunkIndex + 1}/${chunks} chunks).`);
    }
  }

  const committed = await postJson(url, {
    action: "current_commit",
    uploadId,
    expectedRows: parsed.rows.length,
    expectedChunks: chunks
  }, token);

  if (committed.mode !== "FULL_REPLACE_DIRECT" || committed.directWrite !== true || committed.verified !== true ||
      committed.totalWritten !== parsed.rows.length || committed.targetTab !== TARGET_TAB) {
    throw new Error("Commit Current belum terverifikasi lengkap. VEBS tidak mengirim status upload berhasil.");
  }

  return {
    ...committed,
    totalRows: parsed.rows.length,
    duplicateLoanIds: parsed.duplicateLoanIds || 0,
    fileName
  };
}
