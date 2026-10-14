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

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY belum diatur di Railway.");
}
if (!QR_PAGE_TOKEN) {
  throw new Error("QR_PAGE_TOKEN belum diatur di Railway.");
}

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
  res.type("text").send(
    `${BOT_NAME} WhatsApp AI Bot | Status: ${
      connected ? "connected" : "waiting"
    }`
  );
});

app.get("/status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    bot: BOT_NAME,
    whatsapp: connected ? "connected" : "disconnected",
    gemini: "configured",
    groupTrigger: "vebs"
  });
});

app.get("/qr", async (req, res) => {
  if (req.query.token !== QR_PAGE_TOKEN) {
    return res.status(401).type("text").send("Unauthorized");
  }

  res.set("Cache-Control", "no-store");

  if (connected) {
    return res.type("html").send(`<!doctype html>
<html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VEBS</title><body style="font-family:Arial;text-align:center;padding:32px">
<h1>VEBS</h1><h2>WhatsApp sudah terhubung ✅</h2></body></html>`);
  }

  if (!latestQR) {
    return res.status(503).type("html").send(`<!doctype html>
<html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>VEBS QR</title>
<body style="font-family:Arial;text-align:center;padding:32px">
<h2>VEBS sedang menyiapkan QR Code...</h2>
<p>Halaman akan diperiksa kembali dalam 5 detik.</p></body></html>`);
  }

  try {
    const image = await QRCode.toDataURL(latestQR, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 360
    });

    return res.type("html").send(`<!doctype html>
<html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VEBS WhatsApp QR</title>
<body style="font-family:Arial,sans-serif;text-align:center;padding:24px">
<h1>VEBS WhatsApp AI</h1>
<p>WhatsApp → Perangkat tertaut → Tautkan perangkat</p>
<img src="${image}" alt="WhatsApp QR" style="width:min(90vw,360px)">
<p>Jangan bagikan QR atau tautan rahasia ini.</p>
<script>setTimeout(() => location.reload(), 20000)</script>
</body></html>`);
  } catch (error) {
    console.error("QR error:", error.message);
    return res.status(500).send("Gagal membuat QR Code.");
  }
});

function extractText(message) {
  const m = message.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ""
  ).trim();
}

function getHistoryKey(jid, sender) {
  return jid.endsWith("@g.us") ? `${jid}:${sender}` : jid;
}

function isRetryableGeminiError(error) {
  const status = Number(error?.status || error?.code || error?.error?.code);
  const message = String(error?.message || "");
  return [429, 500, 502, 503, 504].includes(status) ||
    /high demand|temporarily unavailable|try again later|UNAVAILABLE|overloaded/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateGeminiResponse(contents, isGroup) {
  const models = [GEMINI_MODEL];
  if (GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
    models.push(GEMINI_FALLBACK_MODEL);
  }

  let lastError;

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: `
Kamu adalah VEBS, asisten AI WhatsApp yang ramah, cerdas, santai, dan membantu.
Gunakan bahasa Indonesia kecuali pengguna meminta bahasa lain.
Jawab dengan jelas, relevan, dan jujur. Jangan mengarang fakta.
${isGroup
  ? "Kamu menjawab di grup WhatsApp. Buat jawaban ringkas, sopan, dan cocok dibaca semua anggota."
  : "Kamu menjawab chat pribadi WhatsApp."}
            `.trim(),
            temperature: 0.7,
            maxOutputTokens: 800
          }
        });

        const answer = response.text?.trim();
        if (!answer) throw new Error("Gemini tidak menghasilkan jawaban.");
        console.log(`[VEBS] Gemini berhasil menjawab dengan model ${model}.`);
        return { answer, model };
      } catch (error) {
        lastError = error;
        console.error(
          `[VEBS] Gemini ${model}, percobaan ${attempt + 1}/3 gagal:`,
          JSON.stringify({
            message: error.message,
            status: error.status || error.code || null
          })
        );

        if (!isRetryableGeminiError(error)) break;
        if (attempt < 2) await sleep(1200 * (2 ** attempt));
      }
    }
  }

  throw lastError || new Error("Semua percobaan Gemini gagal.");
}

async function askGemini(historyKey, userText, isGroup) {
  const history = histories.get(historyKey) || [];
  const contents = [
    ...history,
    { role: "user", parts: [{ text: userText }] }
  ];

  const { answer } = await generateGeminiResponse(contents, isGroup);

  histories.set(historyKey, [
    ...contents,
    { role: "model", parts: [{ text: answer }] }
  ].slice(-MAX_HISTORY_MESSAGES));

  return answer;
}

async function handleMessage(message) {
  if (!message?.message || message.key?.fromMe) return;

  const jid = message.key.remoteJid;
  const sender = message.key.participant || jid;

  if (
    !jid ||
    jid === "status@broadcast" ||
    jid.endsWith("@newsletter")
  ) return;

  const isGroup = jid.endsWith("@g.us");
  const text = extractText(message);
  if (!text) return;

  // Dalam grup, jawab hanya ketika nama VEBS disebut.
  // Chat pribadi tetap mendapat balasan seperti sebelumnya.
  if (isGroup && !TRIGGER_REGEX.test(text)) return;

  const id = message.key.id;
  if (id && processedMessages.has(id)) return;
  if (id) {
    processedMessages.add(id);
    if (processedMessages.size > 1000) {
      processedMessages.delete(processedMessages.values().next().value);
    }
  }

  const historyKey = getHistoryKey(jid, sender);
  const prompt = isGroup
    ? text.replace(TRIGGER_REGEX, "").trim() ||
      "Halo VEBS, sapa grup dengan singkat."
    : text;

  const previous = messageQueue.get(historyKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    try {
      console.log(`[${BOT_NAME}] Pesan ${isGroup ? "grup" : "pribadi"} diterima; target=${isGroup ? "group" : "private"}.`);
      const answer = await askGemini(historyKey, prompt, isGroup);

      if (sock && connected) {
        await sock.sendMessage(jid, { text: answer });
        console.log(`[${BOT_NAME}] Balasan berhasil dikirim.`);
      }
    } catch (error) {
      console.error("Message handling error:", JSON.stringify({
        message: error.message,
        status: error.status || error.code || null
      }));

      if (sock && connected) {
        await sock.sendMessage(jid, {
          text: "Maaf, VEBS sedang mengalami kendala. Coba lagi sebentar ya."
        }).catch((sendError) => {
          console.error("WhatsApp send error:", sendError.message);
        });
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
        console.log("QR tersedia di halaman /qr.");
      }

      if (connection === "open") {
        connected = true;
        latestQR = null;
        starting = false;
        console.log(`${BOT_NAME} terhubung ke WhatsApp.`);
        console.log(`${BOT_NAME} siap merespons sebutan vebs di grup.`);
      }

      if (connection === "close") {
        connected = false;
        starting = false;
        const code = lastDisconnect?.error?.output?.statusCode;

        if (code === DisconnectReason.loggedOut) {
          loggedOut = true;
          latestQR = null;
          console.error("WhatsApp logout. Hubungkan ulang secara manual.");
          return;
        }

        console.log("WhatsApp terputus. Mencoba reconnect dalam 5 detik.");
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          connectWhatsApp().catch((error) => console.error("Reconnect error:", error.message));
        }, 5000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) await handleMessage(message);
    });
  } catch (error) {
    starting = false;
    console.error("WhatsApp startup error:", error.message);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connectWhatsApp().catch((err) => console.error("Reconnect error:", err.message));
    }, 10000);
  }
}

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`${BOT_NAME} server berjalan pada port ${PORT}`);
  connectWhatsApp().catch((error) => console.error("Connection error:", error.message));
});

function shutdown() {
  clearTimeout(reconnectTimer);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
