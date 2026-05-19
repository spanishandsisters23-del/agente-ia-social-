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

async function shopifyFetch(endpoint) {
  const res = await fetch(`https://${SHOPIFY_URL}/admin/api/2024-01/${endpoint}`, {
    headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" },
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
    const [ordersData, productsData, customersData] = await Promise.all([
      shopifyFetch("orders.json?status=any&limit=50&fields=id,total_price,created_at,financial_status,line_items,customer"),
      shopifyFetch("products.json?limit=50&fields=id,title,variants,product_type,status"),
      shopifyFetch("customers.json?limit=50&fields=id,first_name,last_name,email,orders_count,total_spent,created_at"),
    ]);
    const orders = ordersData.orders || [];
    const products = productsData.products || [];
    const customers = customersData.customers || [];
    const totalVentas = orders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
    const ticketMedio = orders.length > 0 ? totalVentas / orders.length : 0;
    const clientesVIP = customers.filter(c => parseFloat(c.total_spent) > 200);
    const productCount = {};
    orders.forEach(o => (o.line_items || []).forEach(item => { productCount[item.title] = (productCount[item.title] || 0) + item.quantity; }));
    const topProductos = Object.entries(productCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, qty]) => ({ title, qty }));
    res.json({
      metricas: { totalPedidos: orders.length, totalVentas: totalVentas.toFixed(2), ticketMedio: ticketMedio.toFixed(2), totalClientes: customers.length, clientesVIP: clientesVIP.length, totalProductos: products.length },
      topProductos,
      ultimosPedidos: orders.slice(0, 5).map(o => ({ id: o.id, total: o.total_price, fecha: o.created_at, estado: o.financial_status, cliente: o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : "Anónimo" })),
      clientesVIP: clientesVIP.slice(0, 5).map(c => ({ nombre: `${c.first_name} ${c.last_name}`, email: c.email, pedidos: c.orders_count, gasto: c.total_spent })),
      clientesRecuperar: customers.filter(c => c.orders_count > 0).slice(0, 5).map(c => ({ nombre: `${c.first_name} ${c.last_name}`, email: c.email, pedidos: c.orders_count, gasto: c.total_spent })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const reply = await callClaude(process.env.AGENT_INSTRUCTIONS || "Eres agente de Spanish & Sisters. Responde en español, tono elegante, máx 3-4 frases. Firma como 'El equipo de Spanish & Sisters'.", message.text.body, 400);
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
