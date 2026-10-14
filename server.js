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
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "";
const QR_PAGE_TOKEN = process.env.QR_PAGE_TOKEN;
const AUTH_DIR = process.env.AUTH_DIR || "/data/auth";

const BOT_NAME = "VEBS";
const TRIGGER_REGEX = /\bvebs\b/i;
const MAX_HISTORY_MESSAGES = 12;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY belum diatur di Railway.");
if (!QR_PAGE_TOKEN) throw new Error("QR_PAGE_TOKEN belum diatur di Railway.");

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
let sock = null;
let latestQR = null;
let connected = false;
let starting = false;
let loggedOut = false;
let reconnectTimer = null;

const histories = new Map();
const messageQueue = new Map();
const processedMessages = new Set();

app.get("/", (_req, res) => {
  res.type("text").send(`${BOT_NAME} WhatsApp AI Bot | Status: ${connected ? "connected" : "waiting"}`);
});

app.get("/status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    bot: BOT_NAME,
    whatsapp: connected ? "connected" : "disconnected",
    geminiModel: GEMINI_MODEL,
    fallbackConfigured: Boolean(GEMINI_FALLBACK_MODEL),
    groupTrigger: "vebs"
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
    console.error("[QR] Error:", error.message);
    return res.status(500).send("Gagal membuat QR Code.");
  }
});

function unwrapMessage(message) {
  let m = message || {};
  for (let i = 0; i < 5; i++) {
    const next =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message;
    if (!next) break;
    m = next;
  }
  return m;
}

function extractText(message) {
  const m = unwrapMessage(message.message);
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  ).trim();
}

function getHistoryKey(jid, sender) {
  return jid.endsWith("@g.us") ? `${jid}:${sender}` : jid;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTemporaryError(error) {
  const status = Number(error?.status || error?.code || error?.error?.code);
  const message = String(error?.message || "");
  return [408, 429, 500, 502, 503, 504].includes(status) ||
    /high demand|temporarily unavailable|try again later|UNAVAILABLE|overloaded|RESOURCE_EXHAUSTED/i.test(message);
}

async function generateWithModel(contents, model, isGroup) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: `Kamu adalah VEBS, asisten AI WhatsApp yang ramah, cerdas, santai, dan membantu. Gunakan bahasa Indonesia kecuali diminta bahasa lain. Jawab jelas dan jujur, jangan mengarang fakta. ${isGroup ? "Kamu membalas di grup WhatsApp; buat jawaban ringkas dan sopan." : "Kamu membalas chat pribadi WhatsApp."}`,
          temperature: 0.7,
          maxOutputTokens: 800
        }
      });
      const answer = result.text?.trim();
      if (!answer) throw new Error("Gemini tidak menghasilkan jawaban.");
      console.log(`[Gemini] Berhasil menggunakan model: ${model}`);
      return answer;
    } catch (error) {
      lastError = error;
      console.error(`[Gemini] model=${model} percobaan=${attempt}/3 status=${error.status || error.code || "unknown"} pesan=${error.message}`);
      if (!isTemporaryError(error)) break;
      if (attempt < 3) await sleep(1000 * attempt * attempt);
    }
  }
  throw lastError || new Error("Gemini gagal tanpa detail.");
}

async function askGemini(historyKey, userText, isGroup) {
  const history = histories.get(historyKey) || [];
  const contents = [...history, { role: "user", parts: [{ text: userText }] }];
  const models = [GEMINI_MODEL];
  if (GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
    models.push(GEMINI_FALLBACK_MODEL);
  }

  let lastError;
  for (const model of models) {
    try {
      const answer = await generateWithModel(contents, model, isGroup);
      histories.set(historyKey, [
        ...contents,
        { role: "model", parts: [{ text: answer }] }
      ].slice(-MAX_HISTORY_MESSAGES));
      return answer;
    } catch (error) {
      lastError = error;
      // Try configured fallback after the primary model fails.
      console.error(`[Gemini] Model ${model} gagal; ${models.length > 1 ? "memeriksa model berikutnya jika tersedia." : "belum ada model cadangan dikonfigurasi."}`);
    }
  }
  throw lastError || new Error("Semua model Gemini gagal.");
}

async function handleMessage(message) {
  if (!message?.message || message.key?.fromMe) return;

  const jid = message.key.remoteJid;
  const sender = message.key.participant || jid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;

  const isGroup = jid.endsWith("@g.us");
  const text = extractText(message);
  const id = message.key.id;

  // Log diagnostik tanpa isi pesan atau nomor anggota.
  console.log(`[WA IN] type=${isGroup ? "GROUP" : "PRIVATE/OTHER"} hasText=${Boolean(text)} trigger=${isGroup && text ? TRIGGER_REGEX.test(text) : false} messageId=${Boolean(id)}`);

  if (!text) return;
  if (isGroup && !TRIGGER_REGEX.test(text)) return;

  if (id && processedMessages.has(id)) return;
  if (id) {
    processedMessages.add(id);
    if (processedMessages.size > 1500) {
      processedMessages.delete(processedMessages.values().next().value);
    }
  }

  const historyKey = getHistoryKey(jid, sender);
  const prompt = isGroup
    ? text.replace(TRIGGER_REGEX, "").trim() || "Halo VEBS, sapa grup dengan singkat."
    : text;

  const previous = messageQueue.get(historyKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    try {
      console.log(`[VEBS] Memproses ${isGroup ? "pesan grup" : "pesan pribadi"}.`);
      const answer = await askGemini(historyKey, prompt, isGroup);
      if (sock && connected) {
        await sock.sendMessage(jid, { text: answer });
        console.log(`[VEBS] Balasan berhasil dikirim ke ${isGroup ? "grup" : "chat pribadi"}.`);
      }
    } catch (error) {
      console.error("[VEBS] Message handling error:", JSON.stringify({
        message: error.message,
        status: error.status || error.code || null
      }));
      if (sock && connected) {
        await sock.sendMessage(jid, {
          text: "Maaf, VEBS sedang mengalami gangguan sementara pada layanan AI. Coba lagi sebentar ya."
        }).catch(sendError => console.error("[WA SEND] Error:", sendError.message));
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
        console.log("[WA] VEBS terhubung ke WhatsApp.");
        console.log("[WA] Pemantauan pesan pribadi dan grup aktif; pemicu grup: vebs.");
      }

      if (connection === "close") {
        connected = false;
        starting = false;
        const code = lastDisconnect?.error?.output?.statusCode;

        if (code === DisconnectReason.loggedOut) {
          loggedOut = true;
          latestQR = null;
          console.error("[WA] Sesi logout; perlu tautkan ulang secara manual.");
          return;
        }

        console.log("[WA] Koneksi terputus; mencoba reconnect dalam 5 detik.");
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          connectWhatsApp().catch(error => console.error("[WA] Reconnect error:", error.message));
        }, 5000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      // Baileys umumnya memakai notify untuk pesan baru. Terima append juga
      // untuk kompatibilitas variasi event, dengan deduplikasi ID.
      if (type !== "notify" && type !== "append") return;
      console.log(`[WA EVENT] messages.upsert type=${type} count=${messages.length}`);
      for (const message of messages) {
        await handleMessage(message);
      }
    });
  } catch (error) {
    starting = false;
    console.error("[WA] Startup error:", error.message);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connectWhatsApp().catch(err => console.error("[WA] Reconnect error:", err.message));
    }, 10000);
  }
}

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[VEBS] Server berjalan di port ${PORT}`);
  connectWhatsApp().catch(error => console.error("[WA] Connection error:", error.message));
});

function shutdown() {
  clearTimeout(reconnectTimer);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
