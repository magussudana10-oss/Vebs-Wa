const DESTINATION_COLUMNS = [
  "regional", "area", "branch", "customer_number", "customer_name", "loan_id",
  "ketua_majelis", "majelis_id", "majelis", "hari_pelayanan", "plafond",
  "disbursement_date", "month", "loan_cycle", "tanggal_approve_uk", "nik_bp",
  "bp", "status_cair", "product_type", "phone_no", "tenor", "kecamatan",
  "kategori_cycle", "sudah_top_up", "sudah_apply", "sudah_approve", "mitra_score",
  "mitra_score_bin", "flag_mitra_score", "bank_name"
];

function normalizeHeader(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isJatim5(value) {
  const v = normalizeHeader(value).replace(/_/g, "");
  return ["jawatimur5", "jatim5", "regionaljawatimur5"].includes(v);
}

function findKpDailySheet(XLSX, workbook) {
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, defval: null, raw: true, blankrows: false
    });
    const scanLimit = Math.min(matrix.length, 30);
    for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
      const headers = matrix[rowIndex].map(normalizeHeader);
      const positions = new Map();
      headers.forEach((h, i) => { if (h && !positions.has(h)) positions.set(h, i); });
      const monthHeader = headers.findIndex(h => h === "month" || h.includes("month"));
      if (monthHeader >= 0 && !positions.has("month")) positions.set("month", monthHeader);
      const missing = DESTINATION_COLUMNS.filter(h => !positions.has(h));
      if (monthHeader >= 0 && missing.length === 0) {
        return { sheetName, matrix, headerRowIndex: rowIndex, positions, monthHeader };
      }
    }
  }
  return null;
}

export function detectKpDailyWorkbook(XLSX, buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const found = findKpDailySheet(XLSX, workbook);
  if (!found) return options.detectOnly ? { isKpDaily: false } : (() => { throw new Error("Header Kp Daily tidak ditemukan. Pastikan 30 kolom B:AE dan header month tersedia."); })();
  if (options.detectOnly) return { isKpDaily: true, sheetName: found.sheetName };

  const rows = [];
  const seenLoanIds = new Set();
  let regionalRows = 0;
  for (let i = found.headerRowIndex + 1; i < found.matrix.length; i++) {
    const source = found.matrix[i];
    if (!source || source.every(v => v === null || v === "")) continue;
    const regionalIndex = found.positions.get("regional");
    if (!isJatim5(source[regionalIndex])) continue;
    regionalRows++;
    const row = DESTINATION_COLUMNS.map(header => source[found.positions.get(header)] ?? "");
    const loanId = String(row[5] ?? "").trim();
    if (!loanId) throw new Error(`Loan ID kosong pada baris sumber ${i + 1}. Proses dihentikan.`);
    if (seenLoanIds.has(loanId)) throw new Error(`Loan ID duplikat dalam file: ${loanId}. Tidak ada data yang dikirim.`);
    seenLoanIds.add(loanId);
    rows.push(row);
  }
  if (!regionalRows || !rows.length) throw new Error("Tidak ditemukan transaksi Regional Jawa Timur 5 pada file Kp Daily.");
  return { isKpDaily: true, sheetName: found.sheetName, rows };
}

export async function uploadKpDailyRows({ url, token, rows }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ token, action: "upload", data: rows }),
      signal: controller.signal,
      redirect: "follow"
    });
    const bodyText = await response.text();
    let payload;
    try { payload = JSON.parse(bodyText); }
    catch {
      throw new Error(`Apps Script tidak mengembalikan JSON (HTTP ${response.status}). Kemungkinan akses Web App masih meminta login Google atau deployment belum diperbarui.`);
    }
    if (!response.ok || payload?.success !== true) {
      throw new Error(payload?.message || payload?.error || `Apps Script gagal (HTTP ${response.status}).`);
    }
    return payload.result || {};
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Koneksi ke Apps Script timeout setelah 90 detik.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
