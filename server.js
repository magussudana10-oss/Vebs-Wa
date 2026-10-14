import express from "express";
import QRCode from "qrcode";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers
} from "@whiskeysockets/baileys";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-3.8-flash").trim();
const GEMINI_FALLBACK_MODEL = (process.env.GEMINI_FALLBACK_MODEL || "").trim();
const QR_PAGE_TOKEN = process.env.QR_PAGE_TOKEN;
const AUTH_DIR = process.env.AUTH_DIR || "/data/auth";

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
    primaryGeminiModel: GEMINI_MODEL,
    fallbackGeminiModels: getGeminiModels().filter(model => model !== GEMINI_MODEL),
    groupTrigger: "vebs (case-insensitive)",
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
          systemInstruction: `Kamu adalah VEBS, asisten AI WhatsApp yang ramah, cerdas, santai, dan membantu. Gunakan bahasa Indonesia kecuali diminta bahasa lain. Jawab jelas dan jujur, jangan mengarang fakta. ${isGroup ? "Kamu membalas di grup WhatsApp; jawab ringkas, relevan, dan sopan." : "Kamu membalas chat pribadi WhatsApp."}`,
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

async function handleMessage(message) {
  if (!message?.message || message.key?.fromMe) return;
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;

  const isGroup = jid.endsWith("@g.us");
  const text = extractText(message);
  const id = message.key?.id;
  const sender = message.key?.participant || jid;
  lastIncomingAt = new Date().toISOString();

  // Log ini harus terlihat saat ada pesan baru; tidak mencetak isi pesan atau nomor anggota.
  console.log(`[WA IN] type=${isGroup ? "GROUP" : "PRIVATE"} hasText=${Boolean(text)} trigger=${isGroup && text ? GROUP_TRIGGER_REGEX.test(text) : false} messageId=${Boolean(id)}`);

  if (!text) {
    console.log("[WA IN] Pesan diabaikan: tidak ada teks/caption yang bisa diproses.");
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
        console.log("[WA] Listener pesan aktif. Grup: balas jika teks mengandung 'vebs'; chat pribadi: balas teks.");
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
