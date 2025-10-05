// api/ai-chat.js
// Standalone chat endpoint with optional multi-turn history.
// - GET  /api/ai-chat?q=hello               (single-turn)
// - POST /api/ai-chat  {messages:[{role,content|text}, ...]}  (multi-turn)
// - GET  /api/ai-chat?diag=1                (health/hasKey check)
//
// Env: OPENAI_API_KEY (preferred)   also accepts OPENAI_APIKEY or OPEN_API_KEY

export default async function handler(req, res) {
  try {
    const apiKey =
      process.env.OPENAI_API_KEY ||
      process.env.OPENAI_APIKEY ||
      process.env.OPEN_API_KEY;

    // Health check
    if (req.method === "GET" && String(req.query.diag || "") === "1") {
      return res.status(200).json({
        diag: {
          hasKey: Boolean(apiKey),
          nodeVersion: process.version,
          ts: new Date().toISOString(),
        },
      });
    }

    if (!apiKey) {
      return res.status(200).json({
        message:
          "Chat is running in demo mode (no API key on the server). Add OPENAI_API_KEY in Vercel → Settings → Environment Variables and redeploy."
      });
    }

    const sys = {
      role: "system",
      content:
        "You are a helpful, concise assistant on a personal dashboard website. " +
        "Prefer short, direct answers. Use the prior messages as shared context."
    };

    let payloadMessages = [sys];

    if (req.method === "GET") {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ error: "Missing q" });
      payloadMessages.push({ role: "user", content: q });
    } else if (req.method === "POST") {
      const { messages } = await readJsonSafe(req);
      if (!Array.isArray(messages) || !messages.length) {
        return res.status(400).json({ error: "POST body must include messages[]" });
      }
      const trimmed = messages.slice(-12).map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.text ?? m.content ?? "")
      }));
      payloadMessages.push(...trimmed);
    } else {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const out = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: payloadMessages
      })
    });

    if (!out.ok) {
      const text = await out.text().catch(()=> "");
      console.error("[ai-chat] upstream error:", out.status, text);
      return res.status(502).json({ message: "Upstream AI error." });
    }

    const data = await out.json();
    const message = data?.choices?.[0]?.message?.content || "…";
    return res.status(200).json({ message });
  } catch (err) {
    console.error("[ai-chat] error:", err);
    return res.status(500).json({ message: "Chat failed." });
  }
}

async function readJsonSafe(req) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
