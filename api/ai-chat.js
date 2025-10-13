// /api/ai-chat.js — v2.3
// - Default: passthrough to OpenAI (plain chat).
// - Live web: auto-use Tavily for fresh info (or if query starts with "/web "),
//   then summarize with OpenAI (mode: "web+llm").
// - Time in <city> & time difference (A vs B): **no network calls** (Intl/ICU).
// - Always returns { message, mode, model, version }.

export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

/* ---------------- small utils ---------------- */
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
        "You are a helpful assistant inside a personal dashboard. Be concise and direct.",
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
        "Chat is in demo mode (no OPENAI_API_KEY set on the server). Add it in Vercel → Settings → Environment Variables.",
      mode: mode === "web+llm" ? "web+llm-demo" : "passthrough-demo",
      model: OPENAI_MODEL,
      version: "2.3",
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
      { message: "Chat failed.", detail, mode, model: OPENAI_MODEL, version: "2.3" },
      500
    );
  }
  const j = await r.json().catch(() => null);
  const message =
    j?.choices?.[0]?.message?.content?.trim() ||
    "I couldn't generate a reply just now.";
  return json({ message, mode, model: OPENAI_MODEL, version: "2.3" });
}

/* ---------------- live web (Tavily) ---------------- */
function wantsWeb(q = "") {
  const s = q.toLowerCase().trim();
  if (/^\/web\s+/.test(s)) return true;

  // Fresh/real-time cues
  const realtimeRe =
    /\b(latest|today|tonight|this week|this month|breaking|update|just now|live|live price|price now|price today|now|currently|forecast|weather|temperature|rain|snow|wind|score|scores|fixtures|schedule|result|results|odds|lineup|transfer|news)\b/;
  if (realtimeRe.test(s)) return true;

  // Transport / timetables (your train example)
  const transportRe =
    /\b(train|next train|timetable|times|schedule|departures?|arrivals?|platform|delays?|status|tube|metro|bus|tram|flight|flights)\b/;
  if (transportRe.test(s)) return true;

  // Finance
  const financeRe = /\b(stock|share|price|market|crypto|bitcoin|ethereum|eth|btc)\b/;
  if (financeRe.test(s) && /\b(now|today|latest|live)\b/.test(s)) return true;

  // Explicit recent years often imply news/freshness
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
    body: JSON.stringify({ query, max_results: 5 }),
  });
  if (!r.ok) return { ok: false, reason: `http ${r.status}`, results: [] };
  const j = await r.json().catch(() => null);
  const results =
    j?.results
      ?.map((x) => ({ title: x.title, url: x.url, snippet: x.content }))
      ?.slice(0, 5) || [];
  return { ok: true, results };
}

async function webThenLLM(userQuery) {
  const q = userQuery.replace(/^\/web\s+/i, "").trim();
  const web = await tavilySearch(q);
  if (!web.ok) {
    const msg =
      web.reason === "no-key"
        ? "Web search is not enabled on this server (missing TAVILY_API_KEY)."
        : `Web search failed (${web.reason}).`;
    return json({ message: msg, mode: "web+llm", model: OPENAI_MODEL, version: "2.3" });
  }
  const context = web.results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join("\n\n");
  const msgs = [
    {
      role: "system",
      content:
        "Summarize briefly from the sources. Use bracket citations like [1], [2]. If steps are requested, use short bullets.",
    },
    { role: "user", content: `Question: ${q}\n\nSources:\n${context}` },
  ];
  return callOpenAI(msgs, "web+llm");
}

/* ---------------- JS-only time (no network) ---------------- */

// Common city → IANA timezone (extendable)
const TZ_MAP = {
  "new york": "America/New_York",
  nyc: "America/New_York",
  london: "Europe/London",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  madrid: "Europe/Madrid",
  rome: "Europe/Rome",
  florence: "Europe/Rome",
  istanbul: "Europe/Istanbul",
  dubai: "Asia/Dubai",
  mumbai: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  bangalore: "Asia/Kolkata",
  tokyo: "Asia/Tokyo",
  sydney: "Australia/Sydney",
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  chicago: "America/Chicago",
  toronto: "America/Toronto",
  "hong kong": "Asia/Hong_Kong",
  singapore: "Asia/Singapore",
};

function findTZ(txt = "") {
  const s = txt.toLowerCase();
  const keys = Object.keys(TZ_MAP).sort((a, b) => b.length - a.length);
  for (const k of keys) if (s.includes(k)) return TZ_MAP[k];
  if (/\b(gmt|utc)\b/.test(s)) return "Etc/UTC";
  return null;
}

function formatInZoneNow(tz) {
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

// Compute UTC offset in minutes for a zone at "now"
function offsetMinutesForZoneNow(tz) {
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
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const h = get("hour");
  const mi = get("minute");
  const s = get("second");

  const utcAssumingWall = Date.UTC(y, (m || 1) - 1, d || 1, h || 0, mi || 0, s || 0);
  const diffMs = utcAssumingWall - now.getTime();
  return Math.round(diffMs / 60000); // minutes; positive = ahead of UTC
}

function isTimeQ(q = "") {
  const s = q.toLowerCase();
  return /\btime\b/.test(s) && !!findTZ(s);
}
function isTimeDiffQ(q = "") {
  const s = q.toLowerCase();
  return (
    /\b(time\s*difference|difference in time|time offset|offset)\b/.test(s) ||
    (/\bbetween\b/.test(s) && /\band\b/.test(s) && /\btime\b/.test(s)) ||
    /\bfrom\s+(gmt|utc)\b/.test(s)
  );
}

async function answerTime(q) {
  const tz = findTZ(q);
  if (!tz)
    return json({
      message:
        "Tell me the city (e.g., “time in New York now?”) and I’ll give you the exact local time.",
      mode: "time-need-city",
      model: OPENAI_MODEL,
      version: "2.3",
    });

  const pretty = formatInZoneNow(tz);
  const city = tz.split("/").pop().replace(/_/g, " ");
  return json({
    message: `${city}: ${pretty}`,
    mode: "time-local",
    model: OPENAI_MODEL,
    version: "2.3",
  });
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
    return json({
      message:
        "Tell me both places, e.g., “time difference London and New York” or “difference from GMT to New York”.",
      mode: "time-diff-need-two",
      model: OPENAI_MODEL,
      version: "2.3",
    });

  const aOff = offsetMinutesForZoneNow(aZ);
  const bOff = offsetMinutesForZoneNow(bZ);
  const diff = bOff - aOff;
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;

  const dir = diff === 0 ? "the same time as" : diff > 0 ? "ahead of" : "behind";
  const span = abs === 0 ? "" : mins ? `${hours}h ${mins}m` : `${hours}h`;

  const A = aZ.split("/").pop().replace(/_/g, " ");
  const B = bZ.split("/").pop().replace(/_/g, " ");
  const msg = diff === 0 ? `${B} is ${dir} ${A}.` : `${B} is ${span} ${dir} ${A}.`;

  return json({ message: msg, mode: "time-diff", model: OPENAI_MODEL, version: "2.3" });
}

/* ---------------- router ---------------- */
async function handle(qRaw, history) {
  const q = (qRaw || "").trim();

  // 1) Time (instant, local)
  if (isTimeDiffQ(q)) return await answerTimeDiff(q);
  if (isTimeQ(q)) return await answerTime(q);

  // 2) Live web when needed
  if (wantsWeb(q)) return await webThenLLM(q);

  // 3) Otherwise: passthrough LLM
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
      { message: "Chat crashed.", error: String(err), mode: "passthrough", model: OPENAI_MODEL, version: "2.3" },
      500
    );
  }
}
