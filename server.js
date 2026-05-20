const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "miagente2024";
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_URL = process.env.SHOPIFY_STORE_URL || "shop.spanishandsisters.com";

async function shopifyGraphQL(query) {
  const res = await fetch(`https://${SHOPIFY_URL}/admin/api/2024-01/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

async function callClaude(system, userMessage, max_tokens = 1000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens, system, messages: [{ role: "user", content: userMessage }] }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

app.get("/", (req, res) => res.send("Agente IA Spanish & Sisters funcionando correctamente OK"));

app.get("/api/shopify/resumen", async (req, res) => {
  try {
    const data = await shopifyGraphQL(`{
      orders(first: 50, reverse: true) {
        edges { node {
          id name totalPriceSet { shopMoney { amount } }
          createdAt displayFinancialStatus
          customer { firstName lastName email }
          lineItems(first: 5) { edges { node { title quantity } } }
        }}
      }
      products(first: 50) {
        edges { node { id title productType status } }
      }
      customers(first: 50, reverse: true) {
        edges { node {
          id firstName lastName email
          numberOfOrders
          amountSpent { amount }
          createdAt
        }}
      }
    }`);

    if (data.errors) {
      return res.status(500).json({ error: data.errors[0].message });
    }

    const orders = (data.data?.orders?.edges || []).map(e => e.node);
    const products = (data.data?.products?.edges || []).map(e => e.node);
    const customers = (data.data?.customers?.edges || []).map(e => e.node);

    const totalVentas = orders.reduce((sum, o) => sum + parseFloat(o.totalPriceSet?.shopMoney?.amount || 0), 0);
    const ticketMedio = orders.length > 0 ? totalVentas / orders.length : 0;
    const clientesVIP = customers.filter(c => parseFloat(c.amountSpent?.amount || 0) > 200);

    const productCount = {};
    orders.forEach(o => (o.lineItems?.edges || []).forEach(e => {
      const item = e.node;
      productCount[item.title] = (productCount[item.title] || 0) + item.quantity;
    }));
    const topProductos = Object.entries(productCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, qty]) => ({ title, qty }));

    res.json({
      metricas: {
        totalPedidos: orders.length,
        totalVentas: totalVentas.toFixed(2),
        ticketMedio: ticketMedio.toFixed(2),
        totalClientes: customers.length,
        clientesVIP: clientesVIP.length,
        totalProductos: products.length,
      },
      topProductos,
      ultimosPedidos: orders.slice(0, 5).map(o => ({
        id: o.name,
        total: o.totalPriceSet?.shopMoney?.amount,
        fecha: o.createdAt,
        estado: o.displayFinancialStatus,
        cliente: o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : "Anónimo",
      })),
      clientesVIP: clientesVIP.slice(0, 5).map(c => ({
        nombre: `${c.firstName} ${c.lastName}`,
        email: c.email,
        pedidos: c.numberOfOrders,
        gasto: c.amountSpent?.amount,
      })),
      clientesRecuperar: customers.filter(c => parseInt(c.numberOfOrders) > 0).slice(0, 5).map(c => ({
        nombre: `${c.firstName} ${c.lastName}`,
        email: c.email,
        pedidos: c.numberOfOrders,
        gasto: c.amountSpent?.amount,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/informe-diario", async (req, res) => {
  try {
    const { datos } = req.body;
    const informe = await callClaude(
      "Eres el agente de inteligencia de negocio de Spanish & Sisters, tienda de moda y accesorios artesanales en Shopify. Tu misión es analizar datos reales y dar recomendaciones concretas para aumentar ventas.",
      `Analiza estos datos reales y genera el informe diario:\n${JSON.stringify(datos, null, 2)}\n\nIncluye:\n1. 📊 RESUMEN DEL DÍA\n2. 🔥 TOP 3 ACCIONES URGENTES HOY\n3. 💰 OPORTUNIDADES DE VENTA\n4. 👥 CLIENTES A CONTACTAR (con mensaje sugerido)\n5. 📦 PRODUCTOS A PROMOCIONAR\n6. 📱 QUÉ PUBLICAR EN INSTAGRAM HOY\n7. 💡 MEJORA PARA MAÑANA\n\nUsa nombres y datos reales. Escribe en español.`
    );
    res.json({ informe });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/claude", async (req, res) => {
  const { messages, system, max_tokens = 1000 } = req.body;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens, system, messages }),
    });
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/webhook/whatsapp", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  mode === "subscribe" && token === VERIFY_TOKEN ? res.status(200).send(challenge) : res.status(403).send("Forbidden");
});

app.post("/webhook/whatsapp", async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== "text") return;
    const phoneNumberId = req.body.entry[0].changes[0].value.metadata.phone_number_id;
    const reply = await callClaude(process.env.AGENT_INSTRUCTIONS || "Eres agente de Spanish & Sisters. Responde en español, tono elegante, máx 3-4 frases.", message.text.body, 400);
    await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, body: JSON.stringify({ messaging_product: "whatsapp", to: message.from, type: "text", text: { body: reply } }) });
  } catch (err) { console.error("Error WA:", err.message); }
});

app.get("/webhook/instagram", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  mode === "subscribe" && token === VERIFY_TOKEN ? res.status(200).send(challenge) : res.status(403).send("Forbidden");
});

app.post("/webhook/instagram", async (req, res) => {
  res.sendStatus(200);
  try {
    const messaging = req.body?.entry?.[0]?.messaging?.[0];
    if (!messaging?.message?.text) return;
    const reply = await callClaude(process.env.AGENT_INSTRUCTIONS || "Eres agente de Spanish & Sisters. Responde en español, tono elegante, máx 3-4 frases.", messaging.message.text, 400);
    await fetch(`https://graph.facebook.com/v19.0/me/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: messaging.sender.id }, message: { text: reply }, access_token: process.env.INSTAGRAM_TOKEN }) });
  } catch (err) { console.error("Error IG:", err.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
