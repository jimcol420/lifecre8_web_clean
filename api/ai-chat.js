// api/ai-chat.js
// Standalone assistant reply for the right-hand chat pane.
// Expects process.env.OPENAI_API_KEY (project-level env var).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      res.status(400).json({ error: "messages required" });
      return;
    }

    // Minimal call using OpenAI Chat Completions API (via fetch)
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // small, cheap, good for chat
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.3
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(()=>"(no body)");
      res.status(500).json({ error: "openai failed", details: errText });
      return;
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content || "(no content)";
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: "server error", details: String(e?.message || e) });
  }
}
