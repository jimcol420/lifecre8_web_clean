export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

// Convert [{role:'user'|'ai', text:string}] → OpenAI chat messages
function toOpenAIMessages(history = [], latestText = "") {
  const msgs = [
    {
      role: "system",
      content:
        "You are a concise, helpful assistant inside a personal dashboard. Prefer short, accurate answers. Use one or two short paragraphs unless the user asks for more.",
    },
  ];
  for (const m of history) {
    if (!m || !m.role || !m.text) continue;
    msgs.push({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.text,
    });
  }
  if (latestText) msgs.push({ role: "user", content: latestText });
  return msgs;
}

async function callOpenAI(messages) {
  const key = OPENAI_API_KEY;
  if (!key) {
    return {
      status: 200,
      body: JSON.stringify({
        message:
          "Chat is running in demo mode (no API key on the server). Add OPENAI_API_KEY in Vercel → Settings → Environment Variables and redeploy.",
      }),
    };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { status: 500, body: JSON.stringify({ message: "Chat failed.", detail }) };
  }

  const data = await res.json().catch(() => null);
  const message =
    data?.choices?.[0]?.message?.content?.trim() ||
    "I couldn't generate a reply just now.";
  return { status: 200, body: JSON.stringify({ message }) };
}

export default async function handler(req) {
  try {
    if (req.method === "POST") {
      const { q, messages: history } = await req.json();
      const msgs = toOpenAIMessages(Array.isArray(history) ? history : [], q || "");
      const result = await callOpenAI(msgs);
      return new Response(result.body, {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET ping / quick single-shot
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const msgs = toOpenAIMessages([], q);
    const result = await callOpenAI(msgs);
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ message: "Chat crashed.", error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
