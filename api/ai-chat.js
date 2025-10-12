// /api/ai-chat.js — v1.5
// - Deterministic capability answer (“Yes, I can do live lookups when needed” if Tavily key present)
// - Accurate time answers via WorldTimeAPI (no key)
// - Web lookups for recency queries on GET and POST
// - Returns {message, mode, version}

export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

/* ---------- helpers ---------- */
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

function needsWeb(q = "") {
  const s = q.toLowerCase().trim();
  if (/^\/search\s+/.test(s)) return true;
  if (/\b(current time|time\s+(in|at)\s+\S+.*(now|right now)?|time\s+now|right now)\b/.test(s)) return true;
  if (/\b(latest|today|this week|this month|breaking|update|news|score|fixtures|schedule|price now|live price|live score)\b/.test(s)) return true;
  if (/\b20(2[3-9]|3\d)\b/.test(s)) return true;
  return false;
}

async function callOpenAI(messages, mode = "llm-only") {
  if (!OPENAI_API_KEY) {
    return {
      status: 200,
      body: JSON.stringify({
        message:
          "Chat is running in demo mode (no OPENAI_API_KEY set). Add it in Vercel → Settings → Environment Variables.",
        mode: "llm-demo",
        version: "1.5",
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
    return { status: 500, body: JSON.stringify({ message: "Chat failed.", detail, mode, version: "1.5" }) };
  }
  const data = await res.json().catch(() => null);
  const message = data?.choices?.[0]?.message?.content?.trim() || "I couldn't generate a reply just now.";
  return { status: 200, body: JSON.stringify({ message, mode, version: "1.5" }) };
}

/* ---------- capability Q ---------- */
function isCapabilityQuestion(q = "") {
  const s = q.toLowerCase();
  return /\b(connected to (the )?internet|live internet|do you browse|can you browse|are you online)\b/.test(s);
}
function capabilityAnswer() {
  if (TAVILY_API_KEY) {
    return {
      status: 200,
      body: JSON.stringify({
        message: "Yes — I can perform live web lookups when a question needs fresh info (e.g., “today”, “latest”) or if you use /search.",
        mode: "capability",
        version: "1.5",
      }),
    };
  }
  return {
    status: 200,
    body: JSON.stringify({
      message: "I can answer normally. To enable live web lookups, add TAVILY_API_KEY to the server.",
      mode: "capability-no-search-key",
      version: "1.5",
    }),
  };
}

/* ---------- accurate time intent ---------- */
const TZ_MAP = {
  "new york": "America/New_York",
  "nyc": "America/New_York",
  "london": "Europe/London",
  "paris": "Europe/Paris",
  "berlin": "Europe/Berlin",
  "madrid": "Europe/Madrid",
  "rome": "Europe/Rome",
  "istanbul": "Europe/Istanbul",
  "dubai": "Asia/Dubai",
  "mumbai": "Asia/Kolkata",
  "delhi": "Asia/Kolkata",
  "bangalore": "Asia/Kolkata",
  "tokyo": "Asia/Tokyo",
  "sydney": "Australia/Sydney",
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  "chicago": "America/Chicago",
  "toronto": "America/Toronto",
};

function isTimeQuestion(q = "") {
  return /\b(time\s+(in|at)\s+|what(?:'| i)?s the time\b|current time|time now|right now)\b/i.test(q);
}

function guessTimezone(q = "") {
  const s = q.toLowerCase();
  const keys = Object.keys(TZ_MAP).sort((a, b) => b.length - a.length);
  for (const k of keys) if (s.includes(k)) return TZ_MAP[k];
  // fallback to London to avoid wrong answers
  return null;
}

async function fetchWorldTime(tz) {
  const res = await fetch(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`, {
    headers: { "cache-control": "no-cache" },
  });
  if (!res.ok) throw new Error(`WorldTimeAPI ${tz} ${res.status}`);
  const j = await res.json();
  return j; // has datetime, utc_offset, dst, timezone
}

async function answerTime(q) {
  const tz = guessTimezone(q);
  if (!tz) {
    return {
      status: 200,
      body: JSON.stringify({
        message: "Tell me the city (e.g., “time in New York now?”) and I’ll give you the exact local time.",
        mode: "time-need-city",
        version: "1.5",
      }),
    };
  }
  try {
    const t = await fetchWorldTime(tz);
    const local = new Date(t.datetime);
    const pretty = local.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', weekday: 'long', month: 'long', day: 'numeric' });
    const msg = `Local time in ${tz.split('/').pop().replace(/_/g,' ')} is ${pretty} (UTC${t.utc_offset}).`;
    return { status: 200, body: JSON.stringify({ message: msg, mode: "time-api", version: "1.5" }) };
  } catch {
    // fallback to web+llm if time API fails
    return await answerWithWebThenLLM(q);
  }
}

/* ---------- web search ---------- */
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

async function answerWithWebThenLLM(query) {
  const web = await webSearch(query);
  if (web.ok && web.results.length) {
    const context = web.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
    const msgs = [
      { role: "system", content: "Summarize briefly and cite with bracket numbers like [1], [2]. If asked for actions, provide short bullet points." },
      { role: "user", content: `Question: ${query}\n\nSources:\n${context}` },
    ];
    const result = await callOpenAI(msgs, "web+llm");
    const body = JSON.parse(result.body);
    return { status: 200, body: JSON.stringify({ message: body.message, mode: "web+llm", version: "1.5" }) };
  }
  if (!web.ok && web.reason === "no-key") {
    return {
      status: 200,
      body: JSON.stringify({
        message: "Web search is not enabled on this server (missing TAVILY_API_KEY).",
        mode: "llm-no-search-key",
        version: "1.5",
      }),
    };
  }
  const msgs = toOpenAIMessages([], query);
  return await callOpenAI(msgs, "llm-only");
}

/* ---------- main handler ---------- */
async function handleQuery(userQ, history, forceWeb = false) {
  const q = (userQ || "").trim();

  // 1) deterministic capability answers
  if (isCapabilityQuestion(q)) return capabilityAnswer();

  // 2) accurate time intent
  if (isTimeQuestion(q)) return await answerTime(q);

  // 3) web mode (explicit or heuristic)
  const wantsWeb = forceWeb || needsWeb(q);
  if (wantsWeb && OPENAI_API_KEY) {
    const query = q.replace(/^\/search\s+/i, "").trim() || q;
    return await answerWithWebThenLLM(query);
  }

  // 4) normal LLM
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
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const forceWeb = (searchParams.get("mode") || "").toLowerCase() === "web";
    const res = await handleQuery(q, [], forceWeb);
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ message: "Chat crashed.", error: String(err), version: "1.5" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
