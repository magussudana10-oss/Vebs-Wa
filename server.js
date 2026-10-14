import express from "express";
import QRCode from "qrcode";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  Browsers
} from "@whiskeysockets/baileys";
import { GoogleGenAI } from "@google/genai";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-3.8-flash").trim();
const GEMINI_FALLBACK_MODEL = (process.env.GEMINI_FALLBACK_MODEL || "").trim();
const QR_PAGE_TOKEN = process.env.QR_PAGE_TOKEN;
const AUTH_DIR = process.env.AUTH_DIR || "/data/auth";
// Memory is stored separately from WhatsApp credentials. Keep /data on a Railway Volume.
const MEMORY_PATH = process.env.VEBS_MEMORY_PATH || "/data/vebs-memory.json";
const MEMORY_ENABLED = String(process.env.VEBS_MEMORY_ENABLED || "true").toLowerCase() !== "false";
const MAX_MEMORY_CHATS = 100;

const BOT_NAME = "VEBS";
const GROUP_TRIGGER_REGEX = /\bvebs\b/i;
const MAX_HISTORY_MESSAGES = 12;
const MAX_PROCESSED_IDS = 2000;
const GEMINI_MAX_ATTEMPTS_PER_MODEL = 2;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY belum diatur di Railway.");
if (!QR_PAGE_TOKEN) throw new Error("QR_PAGE_TOKEN belum diatur di Railway.");

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
let sock = null;
let latestQR = null;
let connected = false;
let starting = false;
let loggedOut = false;
let reconnectTimer = null;
let reconnectDelayMs = 5000;
let incomingEventCount = 0;
let acceptedMessageCount = 0;
let lastIncomingAt = null;

const histories = new Map();
// Load recent conversation context from persistent storage so a Railway restart
// does not automatically erase all assistant context.
function loadPersistentMemory() {
  if (!MEMORY_ENABLED) {
    console.log("[MEMORY] Persistent memory disabled by VEBS_MEMORY_ENABLED=false.");
    return;
  }
  try {
    if (!fs.existsSync(MEMORY_PATH)) {
      console.log("[MEMORY] No saved memory yet; starting with empty context.");
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8"));
    const entries = Object.entries(parsed?.histories || {}).slice(-MAX_MEMORY_CHATS);
    for (const [key, messages] of entries) {
      if (Array.isArray(messages)) {
        histories.set(key, messages.filter(item =>
          item && ["user", "model"].includes(item.role) &&
          Array.isArray(item.parts) && item.parts.every(part => typeof part?.text === "string")
        ).slice(-MAX_HISTORY_MESSAGES));
      }
    }
    console.log(`[MEMORY] Loaded context for ${histories.size} conversation(s).`);
  } catch (error) {
    console.error("[MEMORY] Saved memory could not be loaded; starting fresh:", error?.message || String(error));
  }
}

function savePersistentMemory() {
  if (!MEMORY_ENABLED) return;
  try {
    const parent = path.dirname(MEMORY_PATH);
    fs.mkdirSync(parent, { recursive: true });
    const entries = [...histories.entries()].slice(-MAX_MEMORY_CHATS);
    const payload = JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      histories: Object.fromEntries(entries)
    });
    const tempPath = `${MEMORY_PATH}.tmp`;
    fs.writeFileSync(tempPath, payload, { mode: 0o600 });
    fs.renameSync(tempPath, MEMORY_PATH);
  } catch (error) {
    console.error("[MEMORY] Could not save context:", error?.message || String(error));
  }
}

loadPersistentMemory();

const messageQueue = new Map();
const processedMessages = new Set();

// Model fallback otomatis: jika model utama overload/503, VEBS mencoba model stabil lain.
// Urutannya bisa disesuaikan melalui GEMINI_MODEL dan GEMINI_FALLBACK_MODEL di Railway.
function getGeminiModels() {
  const candidates = [
    GEMINI_MODEL,
    GEMINI_FALLBACK_MODEL,
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite"
  ];
  return [...new Set(candidates.filter(Boolean))];
}

app.get("/", (_req, res) => {
  res.type("text").send(`${BOT_NAME} WhatsApp AI Bot | WhatsApp: ${connected ? "connected" : "waiting"}`);
});

app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: BOT_NAME, uptimeSeconds: Math.floor(process.uptime()) });
});

app.get("/status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    bot: BOT_NAME,
    whatsapp: connected ? "connected" : "disconnected",
    assistantRole: "Personal AI assistant for RM Magus Sudana, Regional Jawa Timur 5",
    persistentMemory: MEMORY_ENABLED,
    savedConversationContexts: histories.size,
    primaryGeminiModel: GEMINI_MODEL,
    fallbackGeminiModels: getGeminiModels().filter(model => model !== GEMINI_MODEL),
    groupTrigger: "vebs (case-insensitive)",
    excelAnalysis: "xlsx/xls/csv attachment; whole file, no area filter",
    kpiTargets: { current: 0.98, dpd1_30: 0.55, dpd31_60: 0.15, dpd61_90: 0.07 },
    incomingUpsertEvents: incomingEventCount,
    acceptedMessages: acceptedMessageCount,
    lastIncomingAt
  });
});

app.get("/qr", async (req, res) => {
  if (req.query.token !== QR_PAGE_TOKEN) return res.status(401).send("Unauthorized");
  res.set("Cache-Control", "no-store");
  if (connected) {
    return res.type("html").send(`<!doctype html><html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VEBS</title><body style="font-family:Arial;text-align:center;padding:32px"><h1>VEBS</h1><h2>WhatsApp sudah terhubung ✅</h2></body></html>`);
  }
  if (!latestQR) {
    return res.status(503).type("html").send(`<!doctype html><html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><body style="font-family:Arial;text-align:center;padding:32px"><h2>VEBS sedang menyiapkan QR Code...</h2></body></html>`);
  }
  try {
    const image = await QRCode.toDataURL(latestQR, { errorCorrectionLevel: "M", margin: 2, width: 360 });
    return res.type("html").send(`<!doctype html><html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VEBS QR</title><body style="font-family:Arial;text-align:center;padding:24px"><h1>VEBS WhatsApp AI</h1><p>WhatsApp → Perangkat tertaut → Tautkan perangkat</p><img src="${image}" alt="WhatsApp QR" style="width:min(90vw,360px)"><p>Jangan bagikan QR atau tautan rahasia ini.</p><script>setTimeout(()=>location.reload(),20000)</script></body></html>`);
  } catch (error) {
    console.error("[QR] Error:", error?.message || String(error));
    return res.status(500).send("Gagal membuat QR Code.");
  }
});

function unwrapMessage(message) {
  let current = message || {};
  for (let i = 0; i < 8; i++) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;
    if (!next) break;
    current = next;
  }
  return current;
}

function extractText(message) {
  const content = unwrapMessage(message?.message);
  return String(
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    content.interactiveResponseMessage?.body?.text ||
    content.pollCreationMessage?.name ||
    ""
  ).trim();
}

function getHistoryKey(jid, sender) {
  return jid.endsWith("@g.us") ? `${jid}:${sender}` : jid;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorDetails(error) {
  const statusCode = Number(
    error?.statusCode ?? error?.status ?? error?.code ??
    error?.error?.statusCode ?? error?.error?.code ?? NaN
  );
  const statusText = String(error?.status || error?.error?.status || "");
  const message = String(error?.message || error?.error?.message || error || "Unknown error");
  return { statusCode: Number.isFinite(statusCode) ? statusCode : null, statusText, message };
}

function isRetryableGeminiError(error) {
  const details = errorDetails(error);
  return [408, 409, 429, 500, 502, 503, 504].includes(details.statusCode) ||
    /high demand|temporarily unavailable|try again later|UNAVAILABLE|overloaded|RESOURCE_EXHAUSTED|deadline|timeout|internal error/i.test(details.message + " " + details.statusText);
}

function isModelOrAccessError(error) {
  const details = errorDetails(error);
  return [400, 403, 404].includes(details.statusCode) ||
    /not found|not supported|permission denied|does not have access|invalid model|API key not valid/i.test(details.message);
}

async function generateWithModel(contents, model, isGroup) {
  let lastError;
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS_PER_MODEL; attempt++) {
    try {
      const result = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: `
Kamu adalah VEBS, AI Agent pribadi untuk membantu pekerjaan Relationship Manager (RM) Regional Jawa Timur 5.

PERAN DAN CARA BERPIKIR:
- Bertindak seperti rekan kerja analis bisnis yang kritis, proaktif dalam analisis, praktis, dan komunikatif; bukan chatbot yang hanya memberi jawaban umum.
- Gunakan bahasa Indonesia yang natural, profesional tetapi santai. Jawab sesuai pertanyaan dan konteks percakapan sebelumnya.
- Pahami konteks kerja: repayment/collection, portfolio quality, Current/DPD 0, DPD 1–30, DPD 31–60, DPD 61–90, RR, Paid, NOA, GAP, movement/flow bucket, Area, Point/Branch, BP, dan Majelis.
- Target KPI acuan bila relevan: Current/DPD 0 = 98%, DPD 1–30 = 55%, DPD 31–60 = 15%, DPD 61–90 = 7%. Jangan menganggap angka ini sebagai hasil aktual.
- Saat diminta menganalisis, susun jawaban: (1) kesimpulan utama, (2) angka/fakta yang tersedia, (3) penyebab atau risiko yang bisa didukung data, (4) prioritas tindakan yang konkret, (5) data tambahan yang diperlukan jika ada kekurangan.
- Prioritaskan dampak bisnis, GAP terhadap target, risiko kenaikan bucket, potensi recovery, serta tindakan yang bisa dilakukan RM, Area, Point, dan BP.
- Jika data file atau angka aktual belum diberikan atau tidak tersedia dalam konteks, katakan secara eksplisit. Jangan mengarang pencapaian, nama Area/Point/BP, penyebab, maupun tren.
- Bedakan fakta dari dugaan. Jika membuat dugaan, beri label sebagai hipotesis dan sebutkan data yang perlu diperiksa.
- Jangan menyatakan sudah membaca file, mengirim laporan, mengubah data, memantau sistem, atau menjalankan tindakan eksternal kecuali benar-benar dilakukan oleh tool yang tersedia.
- Untuk permintaan rumus atau perhitungan, jelaskan basis perhitungan secara ringkas dan konsisten. Jika definisi KPI ambigu, tanyakan klarifikasi daripada diam-diam mengubah definisi.
- Identitas: kamu adalah VEBS, asisten AI pribadi Magus Sudana, RM Regional Jawa Timur 5. Magus adalah pengambil keputusan; kamu memberi analisis, pilihan, risiko, dan rekomendasi, bukan mengaku telah melakukan tindakan yang belum dijalankan.
- Untuk pertanyaan RM, prioritaskan format ringkas: Ringkasan Eksekutif, Fakta/KPI, Risiko atau akar masalah yang didukung data, Prioritas 1–3, dan langkah tindak lanjut.
- Jika konteks percakapan sebelumnya relevan, gunakan untuk memahami pertanyaan lanjutan. Jangan mencampur konteks antar-pengirim atau membocorkan percakapan pribadi ke grup.
- Saat membandingkan performa, periksa penyebut, periode, cutoff, definisi Paid/RR, dan target. Jelaskan jika perbandingan tidak sebanding.
- Untuk Excel repayment, hormati aturan yang sudah ditetapkan sistem: bucket berdasarkan dpd_old, restru dikecualikan, Paid berdasarkan payment_min_1x=Yes, loan_id unik; jangan mengubah aturan tersebut secara diam-diam.
- Berikan tindakan yang spesifik dan dapat dijalankan: siapa/level mana yang perlu fokus, indikator yang perlu diverifikasi, dan ukuran keberhasilan. Jangan menyebut nama atau nilai yang tidak ada dalam data.
- Jangan pernah meminta atau mengungkap API key, token, password, QR rahasia, atau data autentikasi.
${isGroup ? "KONTEKS: Kamu membalas di grup WhatsApp. Jawab ringkas, sopan, tidak membocorkan informasi privat dari percakapan pribadi, dan fokus pada pesan yang menyebut VEBS." : "KONTEKS: Kamu membalas chat pribadi RM. Kamu boleh memberi analisis lebih rinci, membuat prioritas kerja, dan melanjutkan konteks percakapan yang tersedia."}
`, 
          temperature: 0.7,
          maxOutputTokens: 800
        }
      });
      const answer = result.text?.trim();
      if (!answer) throw new Error("Model Gemini tidak menghasilkan teks jawaban.");
      console.log(`[Gemini] Berhasil memakai model ${model}.`);
      return answer;
    } catch (error) {
      lastError = error;
      const details = errorDetails(error);
      console.error(`[Gemini] model=${model} attempt=${attempt}/${GEMINI_MAX_ATTEMPTS_PER_MODEL} status=${details.statusCode ?? details.statusText ?? "unknown"} error=${details.message.slice(0, 300)}`);
      // Model salah/tidak diizinkan: langsung coba model berikutnya, jangan buang waktu retry.
      if (isModelOrAccessError(error)) break;
      if (!isRetryableGeminiError(error) || attempt === GEMINI_MAX_ATTEMPTS_PER_MODEL) break;
      await sleep(800 * attempt);
    }
  }
  throw lastError || new Error(`Model ${model} gagal.`);
}

async function askGemini(historyKey, userText, isGroup) {
  const history = histories.get(historyKey) || [];
  const contents = [...history, { role: "user", parts: [{ text: userText }] }];
  const models = getGeminiModels();
  let lastError;

  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    try {
      const answer = await generateWithModel(contents, model, isGroup);
      histories.set(historyKey, [
        ...contents,
        { role: "model", parts: [{ text: answer }] }
      ].slice(-MAX_HISTORY_MESSAGES));
      // Persist only successful conversational context; never write credentials or QR data.
      if (histories.size > MAX_MEMORY_CHATS) {
        const oldestKey = histories.keys().next().value;
        if (oldestKey !== undefined) histories.delete(oldestKey);
      }
      savePersistentMemory();
      return answer;
    } catch (error) {
      lastError = error;
      const details = errorDetails(error);
      console.error(`[Gemini] Model ${model} gagal (${details.statusCode ?? details.statusText ?? "unknown"}); ${index < models.length - 1 ? `beralih ke cadangan ${models[index + 1]}.` : "semua model cadangan sudah dicoba."}`);
    }
  }
  throw lastError || new Error("Semua model Gemini gagal.");
}

async function sendText(jid, text) {
  if (!sock || !connected) throw new Error("WhatsApp belum terhubung saat akan mengirim balasan.");
  await sock.sendMessage(jid, { text });
}

function getExcelDocument(message) {
  const content = unwrapMessage(message?.message);
  const doc = content?.documentMessage;
  if (!doc) return null;
  const fileName = String(doc.fileName || "uploaded.xlsx");
  const mime = String(doc.mimetype || "").toLowerCase();
  const isExcel = /\.(xlsx|xls|xlsm|csv)$/i.test(fileName) ||
    /spreadsheetml|ms-excel|text\/csv|application\/csv/.test(mime);
  return isExcel ? { fileName, mime } : null;
}

function normalizeYes(value) {
  return ["yes", "ya", "y", "true", "1", "yes "].includes(
    String(value ?? "").trim().toLowerCase()
  );
}

function normalizeDpd(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getKpiBucket(dpd) {
  if (dpd === 0) return { key: "current", label: "CURRENT / DPD 0", target: 0.98 };
  if (dpd >= 1 && dpd <= 30) return { key: "dpd1_30", label: "DPD 1–30", target: 0.55 };
  if (dpd >= 31 && dpd <= 60) return { key: "dpd31_60", label: "DPD 31–60", target: 0.15 };
  if (dpd >= 61 && dpd <= 90) return { key: "dpd61_90", label: "DPD 61–90", target: 0.07 };
  return null;
}

function fmtInt(value) {
  return Math.round(Number(value) || 0).toLocaleString("id-ID");
}

function fmtPct(value) {
  return `${(Number(value) * 100).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function getExcelDate(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}

function parseRepaymentWorkbook(buffer, fileName) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  let rows = [];
  let sheetUsed = "";
  const required = ["loan_id", "dpd_old", "is_loan_restructured", "payment_min_1x"];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const candidate = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    if (!candidate.length) continue;
    const headers = Object.keys(candidate[0]).map(key => key.trim().toLowerCase());
    if (required.every(key => headers.includes(key))) {
      rows = candidate;
      sheetUsed = sheetName;
      break;
    }
  }

  if (!rows.length) {
    throw new Error("Kolom wajib tidak ditemukan. Pastikan ada loan_id, dpd_old, is_loan_restructured, dan payment_min_1x.");
  }
  if (rows.length > 250000) throw new Error("File melebihi batas 250.000 baris untuk analisis WhatsApp.");

  const uniqueLoans = new Map();
  let blankLoanRows = 0;
  for (const row of rows) {
    const loanId = String(row.loan_id ?? "").trim();
    if (!loanId) { blankLoanRows++; continue; }
    const dpd = normalizeDpd(row.dpd_old);
    if (dpd === null) continue;
    const branch = String(row.branch_name || row.point_name || row.area_name || "Tidak diketahui").trim();
    const restructured = normalizeYes(row.is_loan_restructured);
    const paid = normalizeYes(row.payment_min_1x);
    const existing = uniqueLoans.get(loanId);
    if (!existing) {
      uniqueLoans.set(loanId, {
        loanId,
        dpdOld: dpd,
        dpdNew: normalizeDpd(row.dpd_new),
        branch: branch || "Tidak diketahui",
        restructured,
        paid,
        movement: String(row.movement_label || "").trim(),
        cutoff: row.cutoff_bucket || null,
        loanState: String(row.loan_state || "").trim()
      });
    } else {
      existing.restructured = existing.restructured || restructured;
      existing.paid = existing.paid || paid;
      if (!existing.movement && row.movement_label) existing.movement = String(row.movement_label).trim();
    }
  }

  const allLoans = [...uniqueLoans.values()];
  const excludedRestru = allLoans.filter(loan => loan.restructured).length;
  const eligible = allLoans.filter(loan => !loan.restructured);
  const bucketDefs = [
    { key: "current", label: "CURRENT / DPD 0", target: 0.98 },
    { key: "dpd1_30", label: "DPD 1–30", target: 0.55 },
    { key: "dpd31_60", label: "DPD 31–60", target: 0.15 },
    { key: "dpd61_90", label: "DPD 61–90", target: 0.07 }
  ];
  const buckets = new Map(bucketDefs.map(def => [def.key, { ...def, loans: [] }]));
  for (const loan of eligible) {
    const def = getKpiBucket(loan.dpdOld);
    if (def) buckets.get(def.key).loans.push(loan);
  }

  const cutoff = allLoans.find(loan => loan.cutoff)?.cutoff;
  const cutoffText = getExcelDate(cutoff);
  const lines = [
    "🤖 VEBS — REPAYMENT REPORT",
    `📄 ${fileName}`,
    `📅 Cutoff: ${cutoffText}`,
    "🌐 Scope: seluruh data dalam file (tanpa filter area)",
    `🚫 Restru excluded: ${fmtInt(excludedRestru)} loan`,
    "📌 Logic: bucket dari dpd_old | Paid jika payment_min_1x = Yes | loan_id unik"
  ];

  const summary = [];
  for (const def of bucketDefs) {
    const bucket = buckets.get(def.key);
    const loans = bucket.loans;
    if (!loans.length) continue;
    const paidCount = loans.filter(loan => loan.paid).length;
    const noa = loans.length;
    const rr = noa ? paidCount / noa : 0;
    const requiredPaid = Math.ceil(noa * def.target);
    const gap = Math.max(0, requiredPaid - paidCount);
    const targetMet = gap === 0;
    lines.push("");
    lines.push(`📊 REPAYMENT ${def.label}`);
    lines.push(`🎯 Target KPI: ${fmtPct(def.target)}`);

    const byBranch = new Map();
    for (const loan of loans) {
      if (!byBranch.has(loan.branch)) byBranch.set(loan.branch, []);
      byBranch.get(loan.branch).push(loan);
    }
    const branchStats = [...byBranch.entries()].map(([branch, items]) => {
      const branchPaid = items.filter(item => item.paid).length;
      const branchNoa = items.length;
      const branchRR = branchNoa ? branchPaid / branchNoa : 0;
      const branchGap = Math.max(0, Math.ceil(branchNoa * def.target) - branchPaid);
      return { branch, paid: branchPaid, noa: branchNoa, rr: branchRR, gap: branchGap };
    }).sort((a, b) => a.rr - b.rr || b.gap - a.gap || b.noa - a.noa);

    // Tanpa scope area: tampilkan seluruh branch dari file, diurutkan dari RR terendah.
    branchStats.forEach((branch, index) => {
      const icon = branch.gap > 0 ? "🔴" : "🟢";
      const status = branch.gap > 0
        ? `Kurang | kurang ${fmtInt(branch.gap)} loan`
        : `Target tercapai | surplus ${fmtInt(branch.paid - Math.ceil(branch.noa * def.target))} loan`;
      lines.push(`${index + 1}. ${branch.branch} — ${fmtInt(branch.paid)}/${fmtInt(branch.noa)} — ${fmtPct(branch.rr)} ${icon} ${status}`);
    });
    lines.push(`TOTAL — ${fmtInt(paidCount)}/${fmtInt(noa)} — ${fmtPct(rr)} ${targetMet ? "🟢 Target tercapai" : "🔴 Kurang"}${gap > 0 ? ` | kurang ${fmtInt(gap)} loan` : ""}`);

    const worst = branchStats[0];
    if (worst) lines.push(`⚠️ Fokus: ${worst.branch} ${fmtPct(worst.rr)} (target ${fmtPct(def.target)})`);
    summary.push({ ...def, noa, paidCount, rr, gap, branch: worst?.branch || "-", branchRR: worst?.rr ?? 0 });
  }

  const movementLoans = eligible.filter(loan => loan.movement);
  const movementCounts = new Map();
  for (const loan of movementLoans) {
    const label = loan.movement;
    movementCounts.set(label, (movementCounts.get(label) || 0) + 1);
  }
  const flowEntries = [...movementCounts.entries()]
    .filter(([label]) => /flow to|new flow/i.test(label))
    .sort((a, b) => b[1] - a[1]);
  const rollbackCount = [...movementCounts.entries()]
    .filter(([label]) => /rollback/i.test(label))
    .reduce((sum, [, count]) => sum + count, 0);
  const naikCount = flowEntries.reduce((sum, [, count]) => sum + count, 0);

  lines.push("");
  lines.push("➡️ MOVEMENT (restru dikecualikan)");
  if (flowEntries.length) {
    for (const [label, count] of flowEntries.slice(0, 5)) {
      lines.push(`• ${label}: ${fmtInt(count)}`);
    }
  } else {
    lines.push("• Tidak ada flow naik bucket pada data eligible.");
  }
  lines.push(`• Naik bucket: ${fmtInt(naikCount)}`);
  lines.push(`• Rollback turun bucket: ${fmtInt(rollbackCount)}`);

  lines.push("");
  lines.push("💡 SUMMARY");
  if (summary.length) {
    const priority = [...summary].sort((a, b) => (a.rr / a.target) - (b.rr / b.target))[0];
    lines.push(`🔴 Perlu fokus: ${priority.label} ${fmtPct(priority.rr)} (target ${fmtPct(priority.target)})`);
    lines.push(`🎯 Fokus recovery: ${priority.branch} (${priority.label}, ${fmtPct(priority.branchRR)})`);
    lines.push(`📈 KPI dianalisis: ${summary.map(item => item.label).join(", ")}`);
  } else {
    lines.push("Tidak ada pinjaman eligible pada bucket KPI 0–90 setelah restru dikecualikan.");
  }
  if (blankLoanRows) lines.push(`ℹ️ ${fmtInt(blankLoanRows)} baris tanpa loan_id diabaikan.`);
  lines.push("ℹ️ CLOSED mengikuti data sumber; tidak dikecualikan otomatis.");

  return { text: lines.join("\n"), rowCount: rows.length, sheetUsed };
}

async function processExcelAttachment(message, jid, fileInfo, isGroup) {
  try {
    const mediaType = fileInfo.mime || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    console.log(`[EXCEL] Mulai mengunduh dan menganalisis ${fileInfo.fileName} (${isGroup ? "group" : "private"}).`);
    const media = await downloadMediaMessage(message, "buffer", {}, {
      reuploadRequest: sock?.updateMediaMessage
    });
    const buffer = Buffer.isBuffer(media) ? media : Buffer.from(media);
    if (!buffer.length) throw new Error("File Excel kosong atau gagal diunduh.");
    if (buffer.length > 20 * 1024 * 1024) throw new Error("Ukuran file melebihi batas 20 MB.");
    const report = parseRepaymentWorkbook(buffer, fileInfo.fileName);
    console.log(`[EXCEL] Analisis selesai: ${report.rowCount} baris, sheet=${report.sheetUsed}.`);
    await sendText(jid, report.text);
    console.log(`[EXCEL] Report terkirim. mime=${mediaType}; bytes=${buffer.length}.`);
  } catch (error) {
    console.error(`[EXCEL] Gagal analisis: ${error?.message || String(error)}`);
    await sendText(jid,
      "⚠️ VEBS belum bisa membaca file Excel ini. Pastikan format .xlsx/.xls/.csv dan kolom tersedia: loan_id, dpd_old, is_loan_restructured, payment_min_1x.\n" +
      `Detail: ${String(error?.message || error).slice(0, 250)}`
    ).catch(sendError => console.error("[EXCEL] Gagal mengirim error:", sendError?.message || String(sendError)));
  }
}

async function handleMessage(message) {
  if (!message?.message || message.key?.fromMe) return;
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;

  const isGroup = jid.endsWith("@g.us");
  const text = extractText(message);
  const id = message.key?.id;
  const sender = message.key?.participant || jid;
  const excelDocument = getExcelDocument(message);
  lastIncomingAt = new Date().toISOString();

  // Log ini harus terlihat saat ada pesan baru; tidak mencetak isi pesan atau nomor anggota.
  console.log(`[WA IN] type=${isGroup ? "GROUP" : "PRIVATE"} hasText=${Boolean(text)} hasExcel=${Boolean(excelDocument)} trigger=${isGroup && text ? GROUP_TRIGGER_REGEX.test(text) : false} messageId=${Boolean(id)}`);

  if (excelDocument) {
    // Di grup, caption harus menyebut VEBS agar file tidak dianalisis tanpa diminta.
    if (isGroup && !GROUP_TRIGGER_REGEX.test(text)) {
      console.log("[EXCEL] Lampiran grup diabaikan: caption harus menyebut VEBS.");
      return;
    }
    const excelDedupeKey = `${jid}:${id || `${Date.now()}-excel`}`;
    if (processedMessages.has(excelDedupeKey)) return;
    processedMessages.add(excelDedupeKey);
    if (processedMessages.size > MAX_PROCESSED_IDS) processedMessages.delete(processedMessages.values().next().value);
    acceptedMessageCount++;
    await processExcelAttachment(message, jid, excelDocument, isGroup);
    return;
  }

  if (!text) {
    console.log("[WA IN] Pesan diabaikan: tidak ada teks/caption yang bisa diproses.");
    return;
  }
  if (/^(vebs\s+)?(excel analysis|analisa excel|analisis excel|mode excel)$/i.test(text.trim())) {
    await sendText(jid, "📊 Mode Excel Analysis aktif. Kirim file Excel (.xlsx/.xls/.csv). Di grup, sertakan kata VEBS pada caption file. Report mencakup seluruh file tanpa filter area, target Current 98%, DPD 1–30 55%, DPD 31–60 15%, DPD 61–90 7%, RR berdasarkan payment_min_1x=Yes, dan restru dikecualikan.");
    return;
  }
  if (isGroup && !GROUP_TRIGGER_REGEX.test(text)) return;

  const dedupeKey = `${jid}:${id || `${Date.now()}-${text.slice(0, 20)}`}`;
  if (processedMessages.has(dedupeKey)) {
    console.log("[WA IN] Pesan duplikat diabaikan.");
    return;
  }
  processedMessages.add(dedupeKey);
  if (processedMessages.size > MAX_PROCESSED_IDS) {
    processedMessages.delete(processedMessages.values().next().value);
  }
  acceptedMessageCount++;

  const historyKey = getHistoryKey(jid, sender);
  const prompt = isGroup
    ? text.replace(GROUP_TRIGGER_REGEX, "").trim() || "Halo VEBS, sapa grup dengan singkat."
    : text;

  const previous = messageQueue.get(historyKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    try {
      console.log(`[VEBS] Memproses pesan ${isGroup ? "grup" : "pribadi"}.`);
      const answer = await askGemini(historyKey, prompt, isGroup);
      await sendText(jid, answer);
      console.log(`[VEBS] Balasan terkirim ke ${isGroup ? "grup" : "chat pribadi"}.`);
    } catch (error) {
      const details = errorDetails(error);
      console.error(`[VEBS] Gagal memproses pesan: status=${details.statusCode ?? details.statusText ?? "unknown"} error=${details.message.slice(0, 400)}`);
      // Jangan diam total: beri tahu pengirim bahwa seluruh model sedang gagal.
      try {
        await sendText(jid, "Maaf, layanan AI VEBS sedang bermasalah. Saya sudah mencoba model cadangan; coba kirim pesan lagi sebentar ya.");
        console.log("[VEBS] Pesan gangguan berhasil dikirim sebagai fallback.");
      } catch (sendError) {
        console.error("[WA SEND] Gagal mengirim pesan fallback:", sendError?.message || String(sendError));
      }
    }
  });

  messageQueue.set(historyKey, current);
  await current;
  if (messageQueue.get(historyKey) === current) messageQueue.delete(historyKey);
}

async function connectWhatsApp() {
  if (starting || loggedOut) return;
  starting = true;
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu(BOT_NAME),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        latestQR = qr;
        console.log("[WA] QR tersedia di halaman /qr.");
      }
      if (connection === "open") {
        connected = true;
        latestQR = null;
        starting = false;
        reconnectDelayMs = 5000;
        console.log("[WA] VEBS berhasil terhubung ke WhatsApp.");
        console.log("[WA] Listener aktif. Grup: kata VEBS; chat pribadi: teks; Excel Analysis: lampiran xlsx/xls/csv.");
      }
      if (connection === "close") {
        connected = false;
        starting = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          loggedOut = true;
          latestQR = null;
          console.error("[WA] Sesi logout. Tautkan ulang hanya jika WhatsApp meminta.");
          return;
        }
        const delay = reconnectDelayMs;
        reconnectDelayMs = Math.min(Math.round(reconnectDelayMs * 1.5), 30000);
        console.log(`[WA] Koneksi terputus (code=${code ?? "unknown"}); reconnect dalam ${Math.round(delay / 1000)} detik.`);
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          connectWhatsApp().catch(error => console.error("[WA] Reconnect error:", error?.message || String(error)));
        }, delay);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages = [], type }) => {
      incomingEventCount++;
      console.log(`[WA EVENT] messages.upsert type=${type || "unknown"} count=${messages.length}`);
      // 'notify' adalah pesan baru. 'append' biasanya riwayat/sinkronisasi, jangan dibalas
      // agar bot tidak menjawab pesan lama. Event-nya tetap dicatat untuk diagnostik.
      if (type !== "notify") return;
      for (const message of messages) {
        try {
          await handleMessage(message);
        } catch (error) {
          console.error("[WA EVENT] Error saat menangani pesan:", error?.message || String(error));
        }
      }
    });
  } catch (error) {
    starting = false;
    console.error("[WA] Startup error:", error?.message || String(error));
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connectWhatsApp().catch(err => console.error("[WA] Reconnect error:", err?.message || String(err)));
    }, 10000);
  }
}

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[VEBS] HTTP server berjalan di port ${PORT}.`);
  console.log(`[Gemini] Model utama=${GEMINI_MODEL}; model fallback=${getGeminiModels().filter(model => model !== GEMINI_MODEL).join(", ") || "tidak ada"}.`);
  connectWhatsApp().catch(error => console.error("[WA] Connection error:", error?.message || String(error)));
});

function shutdown() {
  clearTimeout(reconnectTimer);
  try { sock?.end?.(new Error("Server shutdown")); } catch {}
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
