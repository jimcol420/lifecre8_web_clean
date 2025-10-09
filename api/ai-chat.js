// /api/ai-chat.js — v1.4
// - Web lookups for BOTH GET and POST
// - Force web via `mode=web` (GET) or `/search ...` (text)
// - Clear 'mode' + 'version' in JSON for quick sanity checks

export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

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
    msgs.push({ role: m.role === "ai" ? "assistant" : "user", content: m.text });
  }
  if (latestText) msgs.push({ role: "user", content: latestText });
  return msgs;
}

// Heuristics for when to browse
function needsWeb(q = "") {
  const s = q.toLowerCase().trim();

  // explicit command
  if (/^\/search\s+/.test(s)) return true;

  // time / now
  if (/\b(current time|time\s+(in|at)\s+\S+.*(now|right now)?|time\s+now|right now)\b/.test(s)) return true;

  // recency signals
  if (/\b(latest|today|this week|this month|breaking|update|news|score|fixtures|schedule|price now|live price|live score)\b/.test(s)) {
    return true;
  }

  // explicit recent years
  if (/\b20(2[3-9]|3\d)\b/.test(s)) return true;

  return false;
}

async function webSearch(query) {
  if (!TAVILY_API_KEY) return { ok: false, reason: "no-key", results: [] };
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 5 }),
  });
  if (!res.ok) return { ok: false, reason: `http ${res.status}`, results: [] };
  const j = await res.json().catch(() => null);
  const results =
    j?.results?.map((r) => ({ title: r.title, url: r.url, snippet: r.content })).slice(0, 5) || [];
  return { ok: true, results };
}

async function callOpenAI(messages, fallbackMode = "llm-only") {
  if (!OPENAI_API_KEY) {
    return {
      status: 200,
      body: JSON.stringify({
        message:
          "Chat is running in demo mode (no OPENAI_API_KEY set). Add it in Vercel → Settings → Environment Variables.",
        mode: "llm-demo",
        version: "1.4",
      }),
    };
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.3 }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { status: 500, body: JSON.stringify({ message: "Chat failed.", detail, mode: fallbackMode, version: "1.4" }) };
  }
  const data = await res.json().catch(() => null);
  const message =
    data?.choices?.[0]?.message?.content?.trim() ||
    "I couldn't generate a reply just now.";
  return { status: 200, body: JSON.stringify({ message, mode: fallbackMode, version: "1.4" }) };
}

async function answerWithWebThenLLM(query) {
  const web = await webSearch(query);
  if (web.ok && web.results.length) {
    const context = web.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
    const msgs = [
      {
        role: "system",
        content: "Summarize briefly and cite with bracket numbers like [1], [2]. If asked for actions, provide short bullet points.",
      },
      { role: "user", content: `Question: ${query}\n\nSources:\n${context}` },
    ];
    const result = await callOpenAI(msgs, "web+llm");
    const body = JSON.parse(result.body);
    return { status: 200, body: JSON.stringify({ message: body.message, mode: "web+llm", version: "1.4" }) };
  }
  if (!web.ok && web.reason === "no-key") {
    return {
      status: 200,
      body: JSON.stringify({
        message: "Web search is not enabled on this server (missing TAVILY_API_KEY).",
        mode: "llm-no-search-key",
        version: "1.4",
      }),
    };
  }
  // Search failed → fall back to LLM-only
  const msgs = toOpenAIMessages([], query);
  const res = await callOpenAI(msgs, "llm-only");
  return res;
}

async function handleQuery(userQ, history, forceWeb = false) {
  const q = (userQ || "").trim();
  const wantsWeb = forceWeb || needsWeb(q);

  if (wantsWeb && OPENAI_API_KEY) {
    const query = q.replace(/^\/search\s+/i, "").trim() || q;
    return await answerWithWebThenLLM(query);
  }

  const msgs = toOpenAIMessages(Array.isArray(history) ? history : [], q);
  return await callOpenAI(msgs, "llm-only");
}

export default async function handler(req) {
  try {
    if (req.method === "POST") {
      const { q, messages: history, forceWeb } = await req.json();
      const res = await handleQuery(q, history, !!forceWeb);
      return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
    }

    // GET mode (now supports web too)
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const modeParam = (searchParams.get("mode") || "").toLowerCase(); // e.g. mode=web
    const forceWeb = modeParam === "web";
    const res = await handleQuery(q, [], forceWeb);
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ message: "Chat crashed.", error: String(err), version: "1.4" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
