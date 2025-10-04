export default async function handler(req, res) {
  try {
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const q = (searchParams.get("q") || "").trim();
    if (!q) return res.status(400).json({ message: "Ask me something." });

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_PUBLIC || process.env.OPENAI_KEY;
    if (!apiKey) return res.status(500).json({ message: "Missing OPENAI_API_KEY" });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are the LifeCre8 assistant. Be concise and helpful. Do not talk about tiles unless the user asks about the dashboard." },
          { role: "user", content: q }
        ],
        temperature: 0.4
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(()=> "");
      return res.status(502).json({ message: "Upstream error", detail: t });
    }
    const j = await r.json();
    const message = j?.choices?.[0]?.message?.content?.trim() || "…";
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ message });
  } catch (err) {
    return res.status(500).json({ message: String(err?.message || err) });
  }
}
