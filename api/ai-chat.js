// /api/ai-chat.js  — robust, with graceful fallbacks
export default async function handler(req, res) {
  try {
    const q = (req.query.q || req.body?.q || "").toString().trim();
    if (!q) {
      return res.status(200).json({ message: "Ask me anything." });
    }

    const key = process.env.OPENAI_API_KEY;

    // If no key is configured, return a friendly stub so the UI works
    if (!key) {
      // Small utility: quick local answers for simple questions
      const lc = q.toLowerCase();
      if (/^what('?s| is) the time/.test(lc)) {
        return res.status(200).json({ message: `It's ${new Date().toLocaleString()}.` });
      }
      return res.status(200).json({
        message:
          "Chat is running in demo mode (no API key on the server). Add OPENAI_API_KEY in Vercel → Settings → Environment Variables and redeploy.",
      });
    }

    // Call OpenAI Chat Completions (simple, non-streaming)
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a concise, helpful assistant." },
          { role: "user", content: q },
        ],
        temperature: 0.3,
      }),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("OpenAI error:", r.status, text);
      return res.status(200).json({
        message: "I had trouble contacting the AI service. Please try again.",
      });
    }

    const data = await r.json();
    const msg =
      data?.choices?.[0]?.message?.content?.trim() ||
      "I don't have a response right now.";

    return res.status(200).json({ message: msg });
  } catch (err) {
    console.error("ai-chat handler error:", err);
    return res.status(200).json({
      message: "Something went wrong on the server. Try again shortly.",
    });
  }
}
