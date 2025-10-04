// Minimal chat endpoint that the Assistant panel calls.
// GET /api/ai-chat?q=your+message
// Responds: { message: "..." }

export default async function handler(req, res) {
  try {
    // Basic CORS (adjust origins as needed)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const q = (req.query.q || "").toString().trim();
    if (!q) return res.status(200).json({ message: "Tell me what you’d like to know." });

    // --- Simple placeholder logic (replace with real LLM later) ---
    // A tiny “useful answer” instead of echoing:
    let reply;
    if (/holiday|trip|break|itinerary|ideas/i.test(q)) {
      reply = "For UK holiday ideas: try the Lake District, Cornwall, the Cotswolds, Isle of Skye, or Snowdonia. Prefer coast, countryside, or city?";
    } else if (/recipe|cook|bake/i.test(q)) {
      reply = "Craving recipes? Say something like “chocolate cake recipe with ganache” and I’ll pull methods, ingredients, and a shopping list.";
    } else if (/car|cars|for sale|autotrader|motors/i.test(q)) {
      reply = "Hunting cars for sale? Try ‘cars for sale in Manchester under £8k’. I can also add a search tile if you’d like.";
    } else {
      reply = `Got it — "${q}". What outcome do you want: a quick answer, a plan, or a tile with live info?`;
    }

    return res.status(200).json({ message: reply });
  } catch (err) {
    console.error("ai-chat error:", err);
    return res.status(200).json({ message: "I had trouble answering just now. Try again in a moment." });
  }
}
