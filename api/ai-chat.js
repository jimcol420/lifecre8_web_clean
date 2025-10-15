// api/ai-chat.js — v3.1 (Edge)
// - Chat with short, helpful replies
// - Smart utilities for current date/time + (optional) web lookups via Tavily
// - Answers next-fixture/weather/time queries when possible

export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || process.env.TAVILY_KEY;

// ---------- tiny utils ----------
const isStr = (v) => typeof v === "string" && v.trim();
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const toISO = (d = new Date()) => new Date(d).toISOString();
function niceDate(d = new Date()) {
  const dt = new Date(d);
  return dt.toLocaleString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
function niceClock(d = new Date()) {
  const dt = new Date(d);
  return dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ---------- intent detectors (cheap + robust) ----------
function detectIntent(q) {
  const s = (q || "").toLowerCase();

  // current date today?
  if (/\b(what('?| i)s|tell me)\b.*\b(date|day)\b|\btoday'?s date\b/.test(s)) {
    return { kind: "date" };
  }

  // time in <place>
  const mTime = s.match(/\btime (in|at)\s+([a-z .,'-]+)\??$/i) || s.match(/^([a-z .,'-]+)\s+time\??$/i);
  if (mTime) return { kind: "time-in", place: (mTime[2] || mTime[1] || "").trim() };

  // weather in <place>
  if (/\bweather\b/.test(s)) {
    const mW = s.match(/\b(weather|forecast)\s+(in|for)\s+([a-z .,'-]+)\b/i);
    if (mW) return { kind: "weather", place: (mW[3] || "").trim() };
    return { kind: "weather", place: "" };
  }

  // fixtures / next fixture
  if (/\bfixture(s)?\b|\bmatch(es)?\b|\bschedule\b|\bkick(-|\s*)off\b/.test(s)) {
    // try to pull a team name by stripping common words
    const cleaned = s
      .replace(/\b(next|today'?s|upcoming|latest|when|what|is|are|the|football|soccer|fixture(s)?|match(es)?|schedule|kick(-|\s*)off)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return { kind: "fixtures", teamHint: cleaned };
  }

  return { kind: "plain" };
}

// ---------- Tavily web search (optional) ----------
async function tavilySearch(q) {
  if (!TAVILY_API_KEY) return null;
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query: q,
      include_answer: true,
      max_results: 5,
      search_depth: "basic",
    }),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j;
}

// ---------- OpenAI ----------
async function openAIChat(messages, temperature = 0.3) {
  if (!OPENAI_API_KEY) {
    return {
      status: 200,
      body: {
        message:
          "Chat is running in demo mode (no API key). Add OPENAI_API_KEY in Vercel → Settings → Environment Variables and redeploy.",
        mode: "demo",
        model: "none",
      },
    };
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature,
      messages,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { status: 500, body: { message: "Chat failed.", detail, mode: "passthrough-error" } };
  }
  const data = await res.json().catch(() => null);
  const message = data?.choices?.[0]?.message?.content?.trim() || "…";
  return { status: 200, body: { message, mode: "passthrough", model: "gpt-4o-mini" } };
}

function toOpenAIMessages(history = [], latestText = "") {
  const msgs = [
    {
      role: "system",
      content:
        "You are a concise, helpful assistant inside a personal dashboard. Prefer short, accurate answers. Use one or two short paragraphs unless the user asks for more.",
    },
  ];
  for (const m of history || []) {
    if (!m || !m.role || !m.text) continue;
    msgs.push({ role: m.role === "ai" ? "assistant" : "user", content: m.text });
  }
  if (latestText) msgs.push({ role: "user", content: latestText });
  return msgs;
}

// ---------- intent executors ----------
async function handleDateIntent() {
  const now = new Date();
  const msg = `Today is **${niceDate(now)}**. (Server time ${niceClock(now)} UTC: ${now.toUTCString().slice(17,22)}).`;
  return { status: 200, body: { message: msg, mode: "local-date" } };
}

async function handleTimeIn(place) {
  // If we have Tavily, try a direct answer
  if (TAVILY_API_KEY && isStr(place)) {
    const t = await tavilySearch(`current local time in ${place}`);
    const answer = t?.answer?.trim();
    if (answer) return { status: 200, body: { message: answer, mode: "web+llm" } };
  }
  // Fallback: pass to LLM (it may still help with offset info)
  return null;
}

async function handleWeather(place) {
  if (TAVILY_API_KEY) {
    const q = isStr(place) ? `weather today in ${place}` : "weather today";
    const t = await tavilySearch(q);
    const answer = t?.answer?.trim();
    if (answer) return { status: 200, body: { message: answer, mode: "web+llm" } };
  }
  return null;
}

async function handleFixtures(teamHint) {
  const q = isStr(teamHint)
    ? `next match fixture for ${teamHint}`
    : `today's big football fixtures with kick-off times`;
  if (TAVILY_API_KEY) {
    const t = await tavilySearch(q);
    const answer = t?.answer?.trim();
    if (answer) return { status: 200, body: { message: answer, mode: "web+llm" } };
  }
  return null;
}

// ---------- HTTP handler ----------
export default async function handler(req) {
  try {
    if (req.method === "POST") {
      const { q, messages: history } = await req.json();
      const latest = (q || "").trim();
      const intent = detectIntent(latest);

      // Fast local answers
      if (intent.kind === "date") {
        const res = await handleDateIntent();
        if (res) return json(res.body, res.status);
      }
      if (intent.kind === "time-in") {
        const res = await handleTimeIn(intent.place);
        if (res) return json(res.body, res.status);
      }
      if (intent.kind === "weather") {
        const res = await handleWeather(intent.place);
        if (res) return json(res.body, res.status);
      }
      if (intent.kind === "fixtures") {
        const res = await handleFixtures(intent.teamHint);
        if (res) return json(res.body, res.status);
      }

      // Pass-through chat (short + helpful)
      const msgs = toOpenAIMessages(Array.isArray(history) ? history : [], latest);
      const out = await openAIChat(msgs);
      return json(out.body, out.status);
    }

    // GET ping
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const mode = (searchParams.get("mode") || "").toLowerCase();

    // allow quick web test via GET ?q=/web something
    if (q.startsWith("/web ")) {
      const t = await tavilySearch(q.replace(/^\/web\s+/, ""));
      const answer = t?.answer?.trim() || "No direct answer found.";
      return json({ message: answer, mode: "web+llm", version: "3.1" });
    }

    // GET date shortcut
    if (mode === "date") {
      const res = await handleDateIntent();
      return json(res.body, res.status);
    }

    const msgs = toOpenAIMessages([], q);
    const out = await openAIChat(msgs);
    return json(out.body, out.status);
  } catch (err) {
    return json({ message: "Chat crashed.", error: String(err) }, 500);
  }
}
