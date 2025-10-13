// /api/ai/ai-chat.js — v3.0 (smart live routing)
// - Auto web for time-sensitive queries (fixtures, schedules, weather, “latest/today/now”, prices)
// - Local time & time-difference (DST-aware via Intl)
// - Passthrough to GPT for everything else
// - Returns { message, mode, model, version } for easy debugging

export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

/* ---------- utils ---------- */
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "Content-Type": "application/json" },
  });

function toOpenAIMessages(history = [], latestText = "") {
  const msgs = [
    {
      role: "system",
      content:
        "You are a helpful in-dashboard assistant. Be concise. Prefer direct answers in 1–3 short paragraphs or bullets.",
    },
  ];
  for (const m of history || []) {
    if (!m || !m.role || !m.text) continue;
    msgs.push({ role: m.role === "ai" ? "assistant" : "user", content: m.text });
  }
  if (latestText) msgs.push({ role: "user", content: latestText });
  return msgs;
}

async function callOpenAI(messages, mode = "passthrough") {
  if (!OPENAI_API_KEY) {
    return json({
      message:
        "Chat is in demo mode (no OPENAI_API_KEY set). Add it in Vercel → Settings → Environment Variables.",
      mode: mode === "web+llm" ? "web+llm-demo" : "passthrough-demo",
      model: OPENAI_MODEL,
      version: "3.0",
    });
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.3, messages }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return json(
      { message: "Chat failed.", detail, mode, model: OPENAI_MODEL, version: "3.0" },
      500
    );
  }
  const j = await r.json().catch(() => null);
  const message =
    j?.choices?.[0]?.message?.content?.trim() ||
    "I couldn't generate a reply just now.";
  return json({ message, mode, model: OPENAI_MODEL, version: "3.0" });
}

/* ---------- live web via Tavily ---------- */
function needsWeb(q = "") {
  const s = q.toLowerCase();

  if (/^\/web\s+/.test(s)) return true; // manual override

  // Obvious “fresh” intents
  if (/\b(latest|today|tonight|now|currently|this (week|month)|breaking|update|live)\b/.test(s))
    return true;

  // Weather / forecast
  if (/\b(weather|forecast|temperature|rain|snow|wind)\b/.test(s)) return true;

  // Transport / schedules
  if (
    /\b(train|timetable|times|schedule|departures?|arrivals?|platform|delays?|status|tube|metro|bus|flight|flights)\b/.test(
      s
    )
  )
    return true;

  // Sports fixtures & results
  if (
    /\b(fixture|fixtures|kick-?off|ko|next match|who (do|does).*(play|vs)|play(?:ing)? (against|vs)|match\s*(schedule|time)|score|scores|result|results)\b/.test(
      s
    )
  )
    return true;

  // Finance “now”
  if (/\b(stock|share|price|market|crypto|bitcoin|btc|ethereum|eth)\b/.test(s) &&
      /\b(now|today|live|latest|currently)\b/.test(s))
    return true;

  // Recent year hints
  if (/\b20(2[3-9]|3\d)\b/.test(s)) return true;

  return false;
}

async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return { ok: false, reason: "no-key", results: [] };
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query, max_results: 6 }),
  });
  if (!r.ok) return { ok: false, reason: `http ${r.status}`, results: [] };
  const j = await r.json().catch(() => null);
  const results =
    j?.results?.map((x) => ({ title: x.title, url: x.url, snippet: x.content })) || [];
  return { ok: true, results: results.slice(0, 6) };
}

async function webThenLLM(userQuery) {
  const q = userQuery.replace(/^\/web\s+/i, "").trim();
  const web = await tavilySearch(q);
  if (!web.ok) {
    const msg =
      web.reason === "no-key"
        ? "Web search isn’t enabled on this server (missing TAVILY_API_KEY)."
        : `Web search failed (${web.reason}).`;
    return json({ message: msg, mode: "web+llm", model: OPENAI_MODEL, version: "3.0" });
  }
  const context = web.results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join("\n\n");
  const msgs = [
    {
      role: "system",
      content:
        "Answer using the sources below. Be concise. Use bracket citations like [1], [2] next to claims.",
    },
    { role: "user", content: `Question: ${q}\n\nSources:\n${context}` },
  ];
  return callOpenAI(msgs, "web+llm");
}

/* ---------- local time & time-difference (no network) ---------- */
const TZ_MAP = {
  "new york": "America/New_York",
  nyc: "America/New_York",
  london: "Europe/London",
  manchester: "Europe/London",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  madrid: "Europe/Madrid",
  rome: "Europe/Rome",
  florence: "Europe/Rome",
  lisbon: "Europe/Lisbon",
  istanbul: "Europe/Istanbul",
  dubai: "Asia/Dubai",
  mumbai: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  tokyo: "Asia/Tokyo",
  sydney: "Australia/Sydney",
  "los angeles": "America/Los_Angeles",
  chicago: "America/Chicago",
  toronto: "America/Toronto",
  "hong kong": "Asia/Hong_Kong",
  singapore: "Asia/Singapore",
};

function findTZ(txt = "") {
  const s = txt.toLowerCase();
  for (const k of Object.keys(TZ_MAP).sort((a, b) => b.length - a.length)) {
    if (s.includes(k)) return TZ_MAP[k];
  }
  if (/\b(gmt|utc)\b/.test(s)) return "Etc/UTC";
  return null;
}
function isTimeQ(q = "") {
  const s = q.toLowerCase();
  return /\btime\b/.test(s) && !!findTZ(s) && !/\btime difference\b/.test(s);
}
function isTimeDiffQ(q = "") {
  const s = q.toLowerCase();
  return (
    /\b(time\s*difference|difference in time|time offset|offset)\b/.test(s) ||
    (/\bbetween\b/.test(s) && /\band\b/.test(s) && /\btime\b/.test(s)) ||
    /\bfrom\s+(gmt|utc)\b/.test(s)
  );
}
function fmtNow(tz) {
  const now = new Date();
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZoneName: "short",
  }).format(now);
}
function offsetMinutesNow(tz) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || "0");
  const y = get("year"), m = get("month"), d = get("day"), h = get("hour"), mi = get("minute"), s = get("second");
  const utcAssumingWall = Date.UTC(y, (m || 1) - 1, d || 1, h || 0, mi || 0, s || 0);
  const diffMs = utcAssumingWall - now.getTime();
  return Math.round(diffMs / 60000); // + = ahead of UTC
}
async function answerTime(q) {
  const tz = findTZ(q);
  if (!tz)
    return json({ message: "Tell me the city, e.g. “time in New York now?”.", mode: "time-need-city", model: OPENAI_MODEL, version: "3.0" });
  const nice = fmtNow(tz);
  const city = tz.split("/").pop().replace(/_/g, " ");
  return json({ message: `${city}: ${nice}`, mode: "time-local", model: OPENAI_MODEL, version: "3.0" });
}
async function answerTimeDiff(q) {
  const s = q.toLowerCase();
  const zones = [];
  for (const k of Object.keys(TZ_MAP).sort((a, b) => b.length - a.length)) {
    if (s.includes(k)) zones.push(TZ_MAP[k]);
  }
  if (/\b(gmt|utc)\b/.test(s)) zones.push("Etc/UTC");
  const [aZ, bZ] = [...new Set(zones)].slice(0, 2);
  if (!aZ || !bZ)
    return json({ message: "Tell me both places, e.g. “time difference London and New York”.", mode: "time-diff-need-two", model: OPENAI_MODEL, version: "3.0" });

  const aOff = offsetMinutesNow(aZ);
  const bOff = offsetMinutesNow(bZ);
  const diff = bOff - aOff;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60), m = abs % 60;
  const dir = diff === 0 ? "the same time as" : diff > 0 ? "ahead of" : "behind";
  const span = abs === 0 ? "" : m ? `${h}h ${m}m` : `${h}h`;
  const A = aZ.split("/").pop().replace(/_/g, " ");
  const B = bZ.split("/").pop().replace(/_/g, " ");
  const msg = diff === 0 ? `${B} is ${dir} ${A}.` : `${B} is ${span} ${dir} ${A}.`;
  return json({ message: msg, mode: "time-diff", model: OPENAI_MODEL, version: "3.0" });
}

/* ---------- router ---------- */
async function handle(qRaw, history) {
  const q = (qRaw || "").trim();

  // 1) Local time helpers
  if (isTimeDiffQ(q)) return await answerTimeDiff(q);
  if (isTimeQ(q)) return await answerTime(q);

  // 2) Live web for time-sensitive stuff
  if (needsWeb(q)) return await webThenLLM(q);

  // 3) Passthrough chat
  const msgs = toOpenAIMessages(Array.isArray(history) ? history : [], q);
  return callOpenAI(msgs, "passthrough");
}

export default async function handler(req) {
  try {
    if (req.method === "POST") {
      const { q, messages: history } = await req.json();
      return await handle(q, history);
    }
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    return await handle(q, []);
  } catch (err) {
    return json(
      { message: "Chat crashed.", error: String(err), mode: "passthrough", model: OPENAI_MODEL, version: "3.0" },
      500
    );
  }
}
