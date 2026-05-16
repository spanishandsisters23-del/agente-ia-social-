const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mi_token_secreto";

// ── Página principal ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("Agente IA funcionando correctamente ✅");
});

// ── Llamar a Claude ───────────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
  const { messages, system, max_tokens = 1000 } = req.body;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens,
        system,
        messages,
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Webhook WhatsApp (verificación Meta) ─────────────────────────
app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook WhatsApp verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── Webhook WhatsApp (mensajes entrantes) ────────────────────────
app.post("/webhook/whatsapp", async (req, res) => {
  res.sendStatus(200); // responde rápido a Meta

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message || message.type !== "text") return;

    const from = message.from;
    const text = message.text.body;
    const phoneNumberId = change.value.metadata.phone_number_id;

    console.log(`📱 WhatsApp de ${from}: ${text}`);

    // Generar respuesta con Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: process.env.AGENT_INSTRUCTIONS ||
          "Eres un agente de atención al cliente amable y profesional. Responde siempre en español, de forma concisa (máx 3-4 frases). Si no puedes resolver algo, di que un miembro del equipo se pondrá en contacto pronto.",
        messages: [{ role: "user", content: text }],
      }),
    });
    const claudeData = await claudeRes.json();
    const reply = claudeData.content?.[0]?.text || "Gracias por tu mensaje, te respondemos pronto.";

    // Enviar respuesta por WhatsApp
    await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: reply },
        }),
      }
    );
    console.log(`✅ Respuesta enviada a ${from}`);
  } catch (err) {
    console.error("Error en webhook WA:", err.message);
  }
});

// ── Webhook Instagram ────────────────────────────────────────────
app.get("/webhook/instagram", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook Instagram verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook/instagram", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const messaging = entry?.messaging?.[0];
    if (!messaging?.message?.text) return;

    const senderId = messaging.sender.id;
    const text = messaging.message.text;
    console.log(`📸 Instagram DM de ${senderId}: ${text}`);

    // Generar respuesta con Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: process.env.AGENT_INSTRUCTIONS ||
          "Eres un agente de atención al cliente amable y profesional. Responde siempre en español, de forma concisa (máx 3-4 frases).",
        messages: [{ role: "user", content: text }],
      }),
    });
    const claudeData = await claudeRes.json();
    const reply = claudeData.content?.[0]?.text || "¡Gracias por escribirnos! Te respondemos enseguida.";

    // Enviar respuesta por Instagram
    await fetch(
      `https://graph.facebook.com/v19.0/me/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: senderId },
          message: { text: reply },
          access_token: process.env.INSTAGRAM_TOKEN,
        }),
      }
    );
    console.log(`✅ Respuesta Instagram enviada a ${senderId}`);
  } catch (err) {
    console.error("Error en webhook IG:", err.message);
  }
});

// ── Arrancar ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
