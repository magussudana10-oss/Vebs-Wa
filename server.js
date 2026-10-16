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
const AMCOLL_WEBAPP_URL = (process.env.AMCOLL_WEBAPP_URL || "").trim();
const AMCOLL_API_TOKEN = (process.env.AMCOLL_API_TOKEN || "").trim();
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
// Antrean global khusus Auto Collection agar laporan lintas chat diproses FIFO.
let collectionQueue = Promise.resolve();
// Scope commands sent as a separate text message can apply to the next Excel file in the same chat.
const pendingScopeRequests = new Map();
const SCOPE_REQUEST_TTL_MS = 30 * 60 * 1000;

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
    excelAnalysis: "xlsx/xls/csv attachment; scope follows requested area/branch when identifiable",
    autoCollectionAmcoll: AMCOLL_WEBAPP_URL && AMCOLL_API_TOKEN ? "configured" : "not_configured",
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
Kamu adalah Vebs, asisten pribadi yang aktif di WhatsApp untuk membantu Magus Sudana, RM Regional Jawa Timur 5.

TUGAS UTAMA:
- Membuat laporan DPD dari setiap file Excel yang dikirim pengguna dan membantu membahas topik, menjawab pertanyaan, serta mengobrol secara natural di chat pribadi maupun grup WhatsApp.
- Untuk file Excel, ikuti instruksi pengguna secara tepat. Jika pengguna meminta satu Area, Branch, Point, KPI, atau periode tertentu, jawab hanya sesuai ruang lingkup tersebut. Jangan menambahkan area atau data lain yang tidak diminta.
- Jangan mengubah hasil, angka, maupun logika analisis Excel yang sudah ditetapkan oleh sistem. Jika data tidak tersedia atau permintaan tidak bisa dipastikan, jelaskan dengan singkat dan jujur.

GAYA KOMUNIKASI DAN KEPRIBADIAN:
- Berbicara santai, ramah, natural, fleksibel, dan terasa seperti percakapan manusia sehari-hari. Hindari gaya AI/bot/customer service yang kaku serta salam formal yang berlebihan.
- Sesuaikan bahasa dengan lawan bicara: gunakan bahasa santai atau gaul yang wajar jika pengguna santai, dan bahasa sopan jika konteksnya formal.
- Gunakan gaya pengetikan WhatsApp yang wajar. Singkatan seperti “yg”, “dgn”, “klo”, “tetep”, atau “gk” boleh digunakan bila cocok dengan konteks; jangan dipaksakan pada setiap jawaban.
- Gunakan emoji seperlunya. Utamakan jawaban yang langsung ke inti dan tidak terlalu panjang, kecuali pengguna meminta penjelasan atau laporan terperinci.
- Variasikan panjang kalimat dan jangan selalu memakai format laporan. Gunakan poin, tabel, atau ringkasan hanya jika memang membantu menjawab permintaan.

CHAT PRIBADI:
- Bersikap hangat dan personal, seperti rekan dekat sekaligus asisten pribadi yang siap membantu.
- Gunakan konteks percakapan sebelumnya yang relevan agar percakapan mengalir. Jangan mengulang pertanyaan yang sudah terjawab di konteks.
- Jika pengguna meminta analisis bisnis/RM, berikan angka dan fakta yang tersedia, gap/risiko yang didukung data, serta tindakan yang relevan. Jangan memaksakan format analisis jika pengguna hanya sedang mengobrol.

GRUP WHATSAPP:
- Tanggapi dengan natural, singkat, dan tidak mengganggu obrolan anggota lain.
- Jawab saat dipanggil, diajak bicara, atau pesan memang relevan dengan VEBS. Jangan menyela atau membalas setiap obrolan antaranggota secara bertubi-tubi.
- Jaga privasi: jangan membawa isi percakapan pribadi ke grup atau membagikan konteks milik pengirim lain.

KEJUJURAN DAN BATASAN:
- Jika tidak tahu, katakan dengan santai dan jujur, misalnya: “Wah, aku belum bisa memastikan soal itu. Perlu dicek dulu ya.” Jangan mengarang fakta, angka, sumber, atau tindakan yang belum dilakukan.
- Jangan mengaku sudah membaca file, mengirim laporan, memeriksa sistem, atau melakukan tindakan eksternal jika tindakan itu belum benar-benar dilakukan.
- Jangan mengaku sebagai manusia sungguhan jika ditanya secara langsung tentang identitas atau sifat sistem. Namun, jangan membahas identitas AI secara tidak perlu; fokuslah pada bantuan yang diminta.
- Jangan pernah meminta atau mengungkap API key, token, password, QR rahasia, atau data autentikasi.

ATURAN ANALISIS DPD/EXCEL YANG WAJIB DIPERTAHANKAN:
- Target acuan bila relevan: Current/DPD 0 = 98%, DPD 1–30 = 55%, DPD 31–60 = 15%, dan DPD 61–90 = 7%. Target bukan angka aktual.
- Bucket ditentukan berdasarkan dpd_old; restruktur dikecualikan; Paid ditentukan oleh payment_min_1x = Yes; loan_id dideduplikasi sesuai logika program.
- Jangan mengubah definisi KPI, cara menghitung RR/Paid, atau aturan filter secara diam-diam. Jangan menebak angka atau nama Area/Branch/Point yang tidak ada pada data.
- Jika scope tertentu diminta, tetap fokus pada scope tersebut dan jangan tampilkan scope lain sebagai tambahan.
${isGroup ? "KONTEKS: Kamu membalas di grup WhatsApp. Respons ringkas dan natural; jaga privasi percakapan pribadi." : "KONTEKS: Kamu membalas chat pribadi. Lanjutkan konteks percakapan yang relevan dan sesuaikan panjang jawaban dengan permintaan pengguna."}
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

function normalizeScopeText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeColumnName(value) {
  return normalizeScopeText(value).replace(/\s+/g, "_");
}

function canonicalizeExcelRow(row) {
  const aliases = {
    loan_id: ["loan_id", "loan id", "loanid", "id loan"],
    dpd_old: ["dpd_old", "dpd old", "dpd_old_bucket", "dpd old bucket"],
    is_loan_restructured: ["is_loan_restructured", "is loan restructured", "loan restructured", "restructured"],
    payment_min_1x: ["payment_min_1x", "payment min 1x", "payment_min1x", "paid"],
    area_name: ["area_name", "area name", "area", "nama area", "nama_area"],
    branch_name: ["branch_name", "branch name", "branch", "nama branch", "nama cabang", "cabang"],
    point_name: ["point_name", "point name", "point", "nama point", "nama poin"],
    dpd_new: ["dpd_new", "dpd new"],
    movement_label: ["movement_label", "movement label"],
    cutoff_bucket: ["cutoff_bucket", "cutoff bucket"],
    loan_state: ["loan_state", "loan state"]
  };
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeColumnName(key), value]));
  const output = { ...row };
  for (const [canonical, variants] of Object.entries(aliases)) {
    for (const variant of variants) {
      const key = normalizeColumnName(variant);
      if (normalized.has(key) && normalized.get(key) !== null && normalized.get(key) !== "") {
        output[canonical] = normalized.get(key);
        break;
      }
    }
  }
  return output;
}

function isExplicitScopeRequest(text) {
  const request = normalizeScopeText(text);
  const hasScopeWord = /\b(area|wilayah|branch|cabang|point|poin|titik)\b/.test(request);
  const hasTargetWord = /\b(saja|only|khusus|hanya)\b/.test(request);
  // A scope instruction is stored only when it names a scope dimension and target.
  return hasScopeWord && (hasTargetWord || /\b(analisa|analisis|tampilkan|ambil|lihat|data|rr|dpd|gap)\b/.test(request));
}

function scopeTextContains(haystack, needle) {
  const h = ` ${normalizeScopeText(haystack)} `;
  const n = ` ${normalizeScopeText(needle)} `;
  return n.trim().length >= 2 && h.includes(n);
}

function extractRequestedName(request, dimension) {
  const normalized = normalizeScopeText(request);
  const labels = dimension === "area" ? "area|wilayah" : dimension === "branch" ? "branch|cabang" : "point|poin|titik";
  const match = normalized.match(new RegExp(`\\b(?:${labels})\\s+(.+)$`));
  if (!match) return "";
  return match[1]
    .replace(/\b(?:saja|only|khusus|hanya|tolong|mohon|ya|dong|vebs|analisa|analisis|tampilkan|ambil|lihat|data|untuk|dengan|dan|pada|di|yang|rr|dpd|gap|current|bucket|loan|paid|mitra|cair|report|laporan)\b.*$/g, "")
    .trim();
}

function resolveRequestedScope(rows, requestText) {
  const request = normalizeScopeText(requestText);
  if (!request) return { type: "all", value: "", matchMode: "no-scope-request" };

  const asksArea = /\b(area|wilayah)\b/.test(request);
  const asksBranch = /\b(branch|cabang)\b/.test(request);
  const asksPoint = /\b(point|poin|titik)\b/.test(request);
  const asksSingleScope = asksArea || asksBranch || asksPoint || /\b(saja|only|khusus|hanya)\b/.test(request);
  if (!asksSingleScope) return { type: "all", value: "", matchMode: "no-scope-request" };

  const distinct = (field) => [...new Set(rows.map(row => String(row[field] ?? "").trim()).filter(Boolean))];
  const areas = distinct("area_name").sort((a, b) => b.length - a.length);
  const branches = distinct("branch_name").sort((a, b) => b.length - a.length);
  const points = distinct("point_name").sort((a, b) => b.length - a.length);
  const exactMention = (values) => values.find(value => scopeTextContains(request, value));

  // Prefer a literal name already present in the relevant Excel column.
  if (asksArea) {
    const exactArea = exactMention(areas);
    if (exactArea) return { type: "area", value: exactArea, matchMode: "exact-area-column" };
  }
  if (asksPoint) {
    const exactPoint = exactMention(points);
    if (exactPoint) return { type: "point", value: exactPoint, matchMode: "exact-point-column" };
  }
  if (asksBranch || asksArea) {
    const exactBranch = exactMention(branches);
    if (exactBranch) return { type: "branch", value: exactBranch, matchMode: "exact-branch-column" };
  }

  // Handle shorthand such as "Area Jember saja" when area_name is blank or
  // the workbook records the area only inside branch_name / point_name.
  const dimension = asksArea ? "area" : asksPoint ? "point" : "branch";
  let requestedName = extractRequestedName(requestText, dimension);
  if (!requestedName && dimension !== "area") requestedName = extractRequestedName(requestText, "area");
  requestedName = normalizeScopeText(requestedName);
  if (requestedName.length >= 2) {
    const rowMatches = rows.filter(row => {
      const area = normalizeScopeText(row.area_name);
      const branch = normalizeScopeText(row.branch_name);
      const point = normalizeScopeText(row.point_name);
      if (dimension === "area") {
        return area === requestedName || area.startsWith(`${requestedName} `) ||
          branch === requestedName || branch.startsWith(`${requestedName} `) || branch.includes(` ${requestedName} `) ||
          point === requestedName || point.startsWith(`${requestedName} `) || point.includes(` ${requestedName} `);
      }
      const value = dimension === "point" ? point : branch;
      return value === requestedName || value.startsWith(`${requestedName} `) || value.includes(` ${requestedName} `);
    });
    if (rowMatches.length) {
      return { type: dimension, value: requestedName, matchMode: "name-derived-from-area-branch-point" };
    }
  }
  return { type: "not_found", value: requestedName || "", matchMode: "scope-not-found" };
}

function parseRepaymentWorkbook(buffer, fileName, requestText = "") {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  let rows = [];
  let sheetUsed = "";
  const required = ["loan_id", "dpd_old", "is_loan_restructured", "payment_min_1x"];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rawCandidate = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    if (!rawCandidate.length) continue;
    const candidate = rawCandidate.map(canonicalizeExcelRow);
    const headers = Object.keys(candidate[0]).map(normalizeColumnName);
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
        area: String(row.area_name ?? "").trim(),
        point: String(row.point_name ?? "").trim(),
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
      if (!existing.area && row.area_name) existing.area = String(row.area_name).trim();
      if (!existing.point && row.point_name) existing.point = String(row.point_name).trim();
    }
  }

  const allLoansUnfiltered = [...uniqueLoans.values()];
  const scope = resolveRequestedScope(rows, requestText);
  if (scope.type === "not_found") {
    const knownAreas = [...new Set(rows.map(row => String(row.area_name ?? "").trim()).filter(Boolean))];
    const knownBranches = [...new Set(rows.map(row => String(row.branch_name ?? row.point_name ?? "").trim()).filter(Boolean))];
    throw new Error(`Filter ${scope.value || "area/branch/point"} tidak cocok dengan data Excel. Tidak ada data seluruh regional yang dikirim sebagai pengganti. Contoh area: ${knownAreas.slice(0, 8).join(", ") || "kolom area_name kosong"}. Contoh branch/point: ${knownBranches.slice(0, 8).join(", ") || "kolom branch_name/point_name kosong"}.`);
  }
  const matchesScopeName = (value, target) => {
    const normalizedValue = normalizeScopeText(value);
    const normalizedTarget = normalizeScopeText(target);
    return Boolean(normalizedTarget) && (
      normalizedValue === normalizedTarget ||
      normalizedValue.startsWith(`${normalizedTarget} `) ||
      normalizedValue.includes(` ${normalizedTarget} `) ||
      normalizedValue.endsWith(` ${normalizedTarget}`)
    );
  };
  const allLoans = scope.type === "area"
    ? allLoansUnfiltered.filter(loan => matchesScopeName(loan.area, scope.value) || matchesScopeName(loan.branch, scope.value) || matchesScopeName(loan.point, scope.value))
    : scope.type === "branch"
      ? allLoansUnfiltered.filter(loan => matchesScopeName(loan.branch, scope.value) || matchesScopeName(loan.point, scope.value))
      : scope.type === "point"
        ? allLoansUnfiltered.filter(loan => matchesScopeName(loan.point, scope.value))
        : allLoansUnfiltered;
  if (scope.type !== "all" && !allLoans.length) {
    throw new Error(`Tidak ada loan yang cocok dengan ${scope.type} ${scope.value} setelah deduplikasi loan_id.`);
  }
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
    scope.type === "area" ? `🎯 Scope: AREA ${scope.value} saja` :
      scope.type === "branch" ? `🎯 Scope: BRANCH/POINT ${scope.value} saja` :
      "🌐 Scope: seluruh data dalam file (tidak ada filter scope pada permintaan)",
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

    // Tampilkan hanya branch/point di dalam scope terpilih; tanpa scope eksplisit, tetap seluruh file.
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
  if (scope.type !== "all") lines.push(`🔒 Filter diterapkan sebelum perhitungan KPI: ${scope.type} ${scope.value}; area/branch lain tidak disertakan.`);

  return { text: lines.join("\n"), rowCount: rows.length, sheetUsed, scope };
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
    const captionText = extractText(message);
    const pending = pendingScopeRequests.get(jid);
    const pendingIsFresh = Boolean(pending && (Date.now() - pending.timestamp) <= SCOPE_REQUEST_TTL_MS);
    const captionHasScope = isExplicitScopeRequest(captionText);
    // A generic caption (e.g. "VEBS" or "file Oktober") must not erase
    // a specific scope instruction sent immediately before the attachment.
    const requestText = captionHasScope
      ? captionText
      : (pendingIsFresh ? pending.text : captionText);
    if (pending && !pendingIsFresh) pendingScopeRequests.delete(jid);
    console.log(`[EXCEL] Scope request source=${captionHasScope ? "caption" : (pendingIsFresh ? "pesan-terakhir" : (captionText ? "caption-no-scope" : "tidak-ada"))}; scopeInstruction=${Boolean(requestText)}; explicitScope=${isExplicitScopeRequest(requestText)}`);
    const report = parseRepaymentWorkbook(buffer, fileInfo.fileName, requestText);
    if (pendingIsFresh) pendingScopeRequests.delete(jid);
    console.log(`[EXCEL] Analisis selesai: ${report.rowCount} baris, sheet=${report.sheetUsed}, scope=${report.scope.type}:${report.scope.value || "-"}.`);
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

function normalizeCollectionIdentity(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

function parseCollectionAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  // Format Indonesia: Rp150.000, 150.000, 150000, atau 150.000,50.
  let cleaned = raw.replace(/rp\.?/gi, "").replace(/\s/g, "");
  if (!/^[+-]?[\d.,]+$/.test(cleaned)) return null;
  if (cleaned.includes(".") && cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    cleaned = parts.length === 2 && parts[1].length <= 2 ? `${parts[0].replace(/\./g, "")}.${parts[1]}` : cleaned.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "");
  }
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseCollectionReports(text) {
  const input = String(text || "").trim();
  if (!input) return null;
  const lines = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const reports = [];
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9._-]+)\s*\/\s*([0-9][0-9.,]*)$/);
    if (!match) return null;
    const loanId = match[1].trim();
    const amountRaw = match[2].trim();
    const amount = parseCollectionAmount(amountRaw);
    reports.push({ loan_id: loanId, nominal_bayar: amountRaw, nominal_bayar_value: amount,
      isComplete: Boolean(loanId && amount !== null && amount > 0) });
  }
  return reports.length ? reports : null;
}

function formatRupiah(amount) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
}

async function submitCollectionReport(payload) {
  if (!AMCOLL_WEBAPP_URL || !AMCOLL_API_TOKEN) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Integrasi spreadsheet Auto Collection belum dikonfigurasi. Laporan tidak direkap." };
  }
  const response = await fetch(AMCOLL_WEBAPP_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, token: AMCOLL_API_TOKEN }),
    signal: AbortSignal.timeout(55000)
  });
  const bodyText = await response.text();
  let result;
  try { result = JSON.parse(bodyText); } catch { throw new Error(`Respons AMCOLL bukan JSON (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(`AMCOLL HTTP ${response.status}: ${result.message || "request gagal"}`);
  return result;
}

function buildCollectionReply(senderName, report, result) {
  const sender = senderName || "Pengirim WhatsApp";
  const customer = report.customer_name || "(kosong)";
  const loanId = report.loan_id || "(kosong)";
  if (result.code === "DUPLICATE") {
    return `⚠️ *LAPORAN PEMBAYARAN DUPLIKAT*\n\nPengirim: ${sender}\nLaporan pembayaran untuk customer *${customer}* dengan Loan ID *${loanId}* terdeteksi sudah pernah dilaporkan dengan nominal yang sama.\nLaporan ini tidak direkap kembali ke spreadsheet.\nSilakan cek laporan sebelumnya sebelum mengirim ulang.`;
  }
  if (result.code === "INVALID_IDENTITY") {
    const mismatch = Array.isArray(result.mismatches) ? result.mismatches : [];
    const details = mismatch.map(item => `• ${item.field}: ${item.message}`).join("\n");
    return `❌ *LAPORAN PEMBAYARAN TIDAK VALID*\n\nPengirim: ${sender}\nCustomer: ${customer}\nLoan ID: ${loanId}\n\nBagian yang tidak cocok:\n${details || "Identitas tidak cocok dengan data Source."}\n\nLaporan tidak dimasukkan ke rekap. Silakan periksa dan kirim ulang setelah diperbaiki.`;
  }
  if (result.code === "AMBIGUOUS") {
    return `⚠️ *LAPORAN BELUM DIREKAP*\n\nPengirim: ${sender}\nData customer *${customer}* dengan Loan ID *${loanId}* cocok dengan lebih dari satu baris Source.\nTidak ada data yang ditulis. Mohon periksa identitas laporan.`;
  }
  if (!result.ok) {
    return `⚠️ *LAPORAN BELUM DIREKAP*\n\nPengirim: ${sender}\nCustomer: ${customer}\nLoan ID: ${loanId}\n\n${result.message || "Laporan belum dapat dicatat."}\nTidak ada konfirmasi berhasil karena penulisan belum terverifikasi.`;
  }
  return `✅ *LAPORAN PEMBAYARAN BERHASIL*\n\nPengirim: ${sender}\nCustomer: ${report.customer_name}\nCustomer Number: ${report.customer_number}\nLoan ID: ${report.loan_id}\nNominal Bayar: ${formatRupiah(report.nominal_bayar_value)}\nBaris Spreadsheet: ${result.row}\n\nLaporan pembayaran telah berhasil dicatat pada baris ${result.row} di sheet *Data Collection Amcoll*.\n\nTerima kasih, *${sender}*! 🙏\nTetap semangat dan terus berikan yang terbaik! 💪🔥\n\nSemoga pencapaiannya semakin meningkat dan target kita bersama bisa tercapai! 🚀`;
}

async function processCollectionReport(message, jid, sender, reports) {
  const messageId = message.key?.id || `${Date.now()}-${Math.random()}`;
  const senderName = String(message.pushName || "").trim() || String(sender || "").split("@")[0] || "Pengirim WhatsApp";
  const receivedAt = new Date(Number(message.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const prepared = reports.map((report, index) => ({
    ...report, whatsapp_message_id: `${jid}:${messageId}:${index + 1}`,
    received_at: receivedAt, sender_name: senderName
  }));
  let results;
  try {
    const response = await submitCollectionReport({ reports: prepared });
    results = Array.isArray(response.results) ? response.results : [response];
  } catch (error) {
    console.error("[AMCOLL] Batch submit gagal:", error?.message || String(error));
    results = prepared.map(() => ({ ok: false, code: "ERROR",
      message: "Kendala saat menghubungi spreadsheet. Status laporan belum dapat dipastikan; cek rekap sebelum mengirim ulang." }));
  }
  const lines = [`📋 *HASIL LAPORAN PEMBAYARAN AMCOLL*`, `Pengirim: ${senderName}`,
    `Jumlah laporan: ${prepared.length}`, ""];
  let successCount = 0, failedCount = 0;
  prepared.forEach((report, index) => {
    const result = results[index] || { ok: false, code: "ERROR", message: "Tidak ada hasil untuk laporan ini." };
    if (result.ok) successCount++; else failedCount++;
    const status = result.ok ? `✅ Berhasil — baris ${result.row}` :
      result.code === "DUPLICATE" ? `⚠️ Duplikat — tidak ditulis ulang${result.row ? ` (baris ${result.row})` : ""}` :
      `❌ Gagal — ${result.message || result.code || "periksa Loan ID/nominal"}`;
    lines.push(`${index + 1}. Loan ID *${report.loan_id}* | Nominal *${formatRupiah(report.nominal_bayar_value || 0)}*`);
    lines.push(`   ${status}`);
  });
  lines.push("", `Ringkasan: ${successCount} berhasil, ${failedCount} perlu diperiksa.`);
  if (failedCount) lines.push("Laporan yang gagal/duplikat tidak dianggap berhasil. Periksa detail di atas sebelum mengirim ulang.");
  else lines.push("Terima kasih, semangat terus! 💪🔥");
  await sendText(jid, lines.join("\n"));
  console.log(`[AMCOLL] batch handled total=${prepared.length} success=${successCount} failed=${failedCount} messageId=${Boolean(messageId)}`);
}

function enqueueCollectionReport(message, jid, sender, report) {
  const current = collectionQueue.catch(() => {}).then(() => processCollectionReport(message, jid, sender, report));
  collectionQueue = current.catch(error => console.error("[AMCOLL] Queue error:", error?.message || String(error)));
  return current;
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

  // Format laporan AMCOLL diproses di chat pribadi maupun grup tanpa wajib menyebut VEBS.
  const collectionReports = text ? parseCollectionReports(text) : null;
  if (collectionReports) {
    const collectionDedupeKey = `${jid}:${id || `${Date.now()}-amcoll`}`;
    if (processedMessages.has(collectionDedupeKey)) return;
    processedMessages.add(collectionDedupeKey);
    if (processedMessages.size > MAX_PROCESSED_IDS) processedMessages.delete(processedMessages.values().next().value);
    acceptedMessageCount++;
    await enqueueCollectionReport(message, jid, sender, collectionReports);
    return;
  }

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
  // Remember an explicit scope command sent as a separate message before the Excel attachment.
  // This is chat-scoped and expires after 30 minutes; it is consumed by the next file.
  if (isExplicitScopeRequest(text)) {
    pendingScopeRequests.set(jid, { text, timestamp: Date.now() });
    console.log(`[EXCEL] Scope instruction saved for next attachment in this chat; chars=${text.length}.`);
  }

  if (/^(vebs\s+)?(excel analysis|analisa excel|analisis excel|mode excel)$/i.test(text.trim())) {
    await sendText(jid, "📊 Mode Excel Analysis aktif. Kirim file Excel (.xlsx/.xls/.csv). Untuk membatasi hasil, tulis perintah di caption file atau kirim perintah scope lalu file dalam chat yang sama dalam 30 menit, misalnya: VEBS analisa Area Jember saja. Jika scope disebutkan tetapi tidak cocok dengan data, VEBS akan memberi error dan tidak mengirim seluruh data sebagai pengganti. Target Current 98%, DPD 1–30 55%, DPD 31–60 15%, DPD 61–90 7%; RR berdasarkan payment_min_1x=Yes, restru dikecualikan.");
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
