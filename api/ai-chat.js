// /api/ai-chat.js — v2.0
// Pure pass-through to OpenAI. No heuristics, no web search.
// Returns { message, mode:"passthrough", model, version }.

export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

const OPENAI_MODEL =
  process.env.OPENAI_MODEL || "gpt-4o-mini"; // change in env if you like

function toOpenAIMessages(history = [], latestText = "") {
  const msgs = [
    // keep the system prompt minimal; not opinionated
    {
      role: "system",
      content:
        "You are a helpful AI assistant inside a personal dashboard. Answer directly and clearly.",
    },
  ];
  for (const m of history || []) {
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
  if (!OPENAI_API_KEY) {
    return {
      status: 200,
      body: JSON.stringify({
        message:
          "Chat is in demo mode (no OPENAI_API_KEY set on the server). Add it in Vercel → Settings → Environment Variables.",
        mode: "passthrough-demo",
        model: OPENAI_MODEL,
        version: "2.0",
      }),
    };
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      status: 500,
      body: JSON.stringify({
        message: "Chat failed.",
        detail,
        mode: "passthrough",
        model: OPENAI_MODEL,
        version: "2.0",
      }),
    };
  }
  const data = await res.json().catch(() => null);
  const message =
    data?.choices?.[0]?.message?.content?.trim() ||
    "I couldn't generate a reply just now.";
  return {
    status: 200,
    body: JSON.stringify({
      message,
      mode: "passthrough",
      model: OPENAI_MODEL,
      version: "2.0",
    }),
  };
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
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const msgs = toOpenAIMessages([], q);
    const result = await callOpenAI(msgs);
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        message: "Chat crashed.",
        error: String(err),
        mode: "passthrough",
        model: OPENAI_MODEL,
        version: "2.0",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
