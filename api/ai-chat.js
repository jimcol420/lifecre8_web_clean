// Force Node runtime (not Edge). This avoids any runtime/env mismatch.
export const config = { runtime: "nodejs" };

// Minimal helper to avoid leaking your key while still debugging.
function redact(key) {
  if (!key) return null;
  return key.slice(0, 7) + "…" + key.slice(-4);
}

export default async function handler(req, res) {
  // Accept a few legacy names, but prefer OPENAI_API_KEY
  const key =
    process.env.OPENAI_API_KEY ||
    process.env.OPEN_API_KEY ||
    process.env.OPENAI_KEY ||
    "";

  const diag = {
    hasKey: Boolean(key),
    envNameUsed: process.env.OPENAI_API_KEY
      ? "OPENAI_API_KEY"
      : process.env.OPEN_API_KEY
      ? "OPEN_API_KEY"
      : process.env.OPENAI_KEY
      ? "OPENAI_KEY"
      : null,
    keyPreview: redact(key), // safe preview, not the full key
    nodeVersion: process.version,
    ts: new Date().toISOString(),
  };

  // Quick diagnostic mode:
  // - /api/ai-chat?debug=1  -> returns diag only (no OpenAI call)
  if (req.query.debug === "1") {
    return res.status(200).json({ diag });
  }

  if (!key) {
    // Same message as before, but now you can confirm with ?debug=1
    return res.status(200).json({
      message:
        "Chat is running in demo mode (no API key on the server). Add OPENAI_API_KEY in Vercel → Settings → Environment Variables and redeploy.",
    });
  }

  try {
    const q = (req.query.q || "").toString().trim() || "Say hello in one short line.";

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a friendly, concise assistant." },
          { role: "user", content: q },
        ],
        temperature: 0.3,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      return res
        .status(500)
        .json({ message: "OpenAI request failed.", status: r.status, detail: text });
    }

    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content?.trim() || "…";
    return res.status(200).json({ message: content });
  } catch (err) {
    return res.status(500).json({ message: "Server error.", error: String(err) });
  }
}
