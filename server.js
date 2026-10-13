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
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const QR_PAGE_TOKEN = process.env.QR_PAGE_TOKEN;
const AUTH_DIR = process.env.AUTH_DIR || "./auth_info";
const BOT_NAME = "VEBS";

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY belum diatur pada environment variables.");
}
if (!QR_PAGE_TOKEN) {
  throw new Error("QR_PAGE_TOKEN belum diatur pada environment variables.");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

let sock;
let latestQR = null;
let connected = false;
let reconnectTimer = null;
let isStarting = false;
let loggedOut = false;
const histories = new Map();
const MAX_HISTORY_MESSAGES = 12;
const messageQueue = new Map();

app.get("/", (_req, res) => {
  res.type("text").send(
    `${BOT_NAME} WhatsApp AI Bot | Status: ${connected ? "connected" : "waiting"}`
  );
});

app.get("/status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    bot: BOT_NAME,
    whatsapp: connected ? "connected" : "disconnected",
    gemini: "configured"
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
<h2>VEBS sedang menyiapkan QR Code...</h2><p>Halaman akan diperiksa lagi dalam 5 detik.</p>
</body></html>`);
  }

  try {
    const dataUrl = await QRCode.toDataURL(latestQR, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 360
    });

    return res.type("html").send(`<!doctype html>
<html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hubungkan WhatsApp ke VEBS</title>
<body style="font-family:Arial,sans-serif;text-align:center;padding:24px">
<h1>VEBS WhatsApp AI</h1>
<p>Di WhatsApp buka <b>Perangkat tertaut → Tautkan perangkat</b>, lalu scan QR ini.</p>
<img src="${dataUrl}" alt="WhatsApp QR Code" style="width:min(90vw,360px)">
<p>Halaman memperbarui QR setiap 20 detik.</p>
<p><b>Jangan bagikan QR atau token halaman ini.</b></p>
<script>setTimeout(()=>location.reload(),20000)</script>
</body></html>`);
  } catch (error) {
    console.error("QR generation failed:", error.message);
    return res.status(500).type("text").send("Gagal membuat QR Code.");
  }
});

function getText(message) {
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

async function askGemini(sender, userText) {
  const history = histories.get(sender) || [];
  const contents = [
    ...history,
    { role: "user", parts: [{ text: userText }] }
  ];

  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction:
        "Kamu adalah VEBS, asisten AI WhatsApp yang ramah, santai, cerdas, dan membantu. " +
        "Utamakan bahasa Indonesia, jawab dengan jelas dan jujur. " +
        "Jika tidak tahu jawabannya, katakan dengan jujur.",
      temperature: 0.7,
      maxOutputTokens: 800
    }
  });

  const answer = result.text?.trim();
  if (!answer) throw new Error("Gemini tidak menghasilkan teks jawaban.");

  histories.set(sender, [
    ...contents,
    { role: "model", parts: [{ text: answer }] }
  ].slice(-MAX_HISTORY_MESSAGES));

  return answer;
}

async function processIncomingMessage(message) {
  if (!message?.message || message.key?.fromMe) return;

  const jid = message.key.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us")) return;
  if (message.key.remoteJid?.endsWith("@newsletter")) return;

  const userText = getText(message);
  if (!userText) return;

  // Serialkan pesan dari pengirim yang sama agar urutan percakapan terjaga.
  const previous = messageQueue.get(jid) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      try {
        console.log(`${BOT_NAME}: pesan masuk dari ${jid}`);
        const answer = await askGemini(jid, userText);
        if (sock && connected) {
          await sock.sendMessage(jid, { text: answer });
        }
      } catch (error) {
        console.error("Message handling error:", error.message);
        if (sock && connected) {
          await sock.sendMessage(jid, {
            text: "Maaf, VEBS sedang mengalami kendala. Coba lagi sebentar ya."
          }).catch(() => {});
        }
      }
    });

  messageQueue.set(jid, current);
  await current;
  if (messageQueue.get(jid) === current) messageQueue.delete(jid);
}

async function connectWhatsApp() {
  if (isStarting || loggedOut) return;
  isStarting = true;

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
        console.log("QR baru tersedia. Buka halaman /qr dengan token yang benar.");
      }

      if (connection === "open") {
        connected = true;
        latestQR = null;
        console.log(`${BOT_NAME} berhasil terhubung ke WhatsApp.`);
      }

      if (connection === "close") {
        connected = false;
        const code = lastDisconnect?.error?.output?.statusCode;

        if (code === DisconnectReason.loggedOut) {
          loggedOut = true;
          latestQR = null;
          console.error("Sesi WhatsApp logout. Perlu menautkan ulang secara manual.");
          return;
        }

        console.log("Koneksi terputus; mencoba reconnect dalam 5 detik.");
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          isStarting = false;
          connectWhatsApp().catch((error) => {
            console.error("Reconnect error:", error.message);
          });
        }, 5000);
      }

      if (connection === "open") isStarting = false;
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) {
        await processIncomingMessage(message);
      }
    });
  } catch (error) {
    console.error("WhatsApp startup error:", error.message);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      isStarting = false;
      connectWhatsApp().catch((err) => console.error(err.message));
    }, 10000);
  } finally {
    // The connection.update handler controls isStarting after a successful start.
    if (!sock) isStarting = false;
  }
}

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`${BOT_NAME} server berjalan pada port ${PORT}`);
  connectWhatsApp().catch((error) => console.error(error.message));
});

process.on("SIGTERM", () => {
  clearTimeout(reconnectTimer);
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  clearTimeout(reconnectTimer);
  server.close(() => process.exit(0));
});
