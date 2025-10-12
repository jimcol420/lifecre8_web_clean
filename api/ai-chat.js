// /api/ai/ai-chat.js — v2.1
// Behavior:
// - Default: pure ChatGPT-style passthrough to OpenAI (no curation).
// - Live mode: if the query clearly needs fresh info (latest/today/price now/news/etc)
//              OR the user starts with "/web ", we call Tavily, then summarize with OpenAI.
// - Accurate "time in <city>" and "time difference <A> and <B>" via public time APIs.
// - Returns { message, mode, model, version } for sanity checks.

export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

/* ---------------- core helpers ---------------- */
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

function toOpenAIMessages(history = [], latestText = "") {
  const msgs = [
    { role: "system", content: "You are a helpful AI assistant inside a personal dashboard. Be concise and direct." },
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
      message: "Chat is in demo mode (no OPENAI_API_KEY set).",
      mode: mode === "web+llm" ? "web+llm-demo" : "passthrough-demo",
      model: OPENAI_MODEL,
      version: "2.1",
    });
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.3, messages }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return json({ message: "Chat failed.", detail, mode, model: OPENAI_MODEL, version: "2.1" }, 500);
  }
  const j = await r.json().catch(() => null);
  const message = j?.choices?.[0]?.message?.content?.trim() || "I couldn't generate a reply just now.";
  return json({ message, mode, model: OPENAI_MODEL, version: "2.1" });
}

/* ---------------- live-web (Tavily) ---------------- */
function wantsWeb(q = "") {
  const s = q.toLowerCase().trim();
  if (/^\/web\s+/.test(s)) return true;
  if (/\b(latest|today|this week|this month|breaking|update|just now|live|live price|price now|price today|score|fixtures|schedule|news)\b/.test(s)) return true;
  if (/\b20(2[3-9]|3\d)\b/.test(s)) return true; // explicit recent years
  return false;
}

async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return { ok: false, reason: "no-key", results: [] };
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 5 }),
  });
  if (!r.ok) return { ok: false, reason: `http ${r.status}`, results: [] };
  const j = await r.json().catch(() => null);
  const results =
    j?.results?.map(x => ({ title: x.title, url: x.url, snippet: x.content }))?.slice(0, 5) || [];
  return { ok: true, results };
}

async function webThenLLM(userQuery) {
  const q = userQuery.replace(/^\/web\s+/i, "").trim();
  const web = await tavilySearch(q);
  if (!web.ok) {
    const msg = web.reason === "no-key"
      ? "Web search is not enabled on this server (missing TAVILY_API_KEY)."
      : `Web search failed (${web.reason}).`;
    return json({ message: msg, mode: "web+llm", model: OPENAI_MODEL, version: "2.1" });
  }
  const context = web.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
  const msgs = [
    { role: "system", content: "Summarize briefly from the sources. Use bracket citations like [1], [2]. If steps are requested, use short bullets." },
    { role: "user", content: `Question: ${q}\n\nSources:\n${context}` },
  ];
  return callOpenAI(msgs, "web+llm");
}

/* ---------------- time (real-time APIs) ---------------- */
const TZ_MAP = {
  "new york":"America/New_York","nyc":"America/New_York",
  "london":"Europe/London","paris":"Europe/Paris","berlin":"Europe/Berlin","madrid":"Europe/Madrid","rome":"Europe/Rome",
  "istanbul":"Europe/Istanbul","dubai":"Asia/Dubai",
  "mumbai":"Asia/Kolkata","delhi":"Asia/Kolkata","bangalore":"Asia/Kolkata",
  "tokyo":"Asia/Tokyo","sydney":"Australia/Sydney","los angeles":"America/Los_Angeles","san francisco":"America/Los_Angeles",
  "chicago":"America/Chicago","toronto":"America/Toronto","hong kong":"Asia/Hong_Kong","singapore":"Asia/Singapore"
};
function findTZ(txt=""){
  const s = txt.toLowerCase();
  const keys = Object.keys(TZ_MAP).sort((a,b)=>b.length-a.length);
  for (const k of keys) if (s.includes(k)) return TZ_MAP[k];
  if (/\bgmt\b/.test(s) || /\butc\b/.test(s)) return "Etc/UTC";
  return null;
}
const abortable = (url, init={}, ms=2500) => {
  const ctl = new AbortController(); const t = setTimeout(()=>ctl.abort(), ms);
  return fetch(url, { ...init, signal: ctl.signal }).finally(()=>clearTimeout(t));
};
async function wta(tz){
  const r = await abortable(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`, { headers:{ "cache-control":"no-cache" }});
  if (!r.ok) throw new Error(`wta ${r.status}`);
  const j = await r.json(); return { iso: j.datetime, offset: j.utc_offset };
}
async function tai(tz){
  const r = await abortable(`https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(tz)}`, { headers:{ "cache-control":"no-cache" }});
  if (!r.ok) throw new Error(`tai ${r.status}`);
  const j = await r.json();
  return j?.dateTime ? { iso: j.dateTime, offset: j?.timeZone?.utcOffset || "" }
                     : { iso: `${j.year}-${String(j.month).padStart(2,"0")}-${String(j.day).padStart(2,"0")}T${j.time??"00:00:00"}`, offset: "" };
}
function fmt(iso, tz){
  const dt = new Date(iso);
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour:'numeric', minute:'2-digit', weekday:'short', month:'short', day:'numeric', timeZoneName:'short' }).format(dt);
}
function offMin(s="+00:00"){ const m=s.match(/([+-])(\d{2}):?(\d{2})?/); if(!m)return 0; const sign=m[1]==="-"?-1:1; return sign*((+m[2])*60+(+m[3]||0)); }
function isTimeQ(q=""){ const s=q.toLowerCase(); return /\btime\b/.test(s) && !!findTZ(s); }
function isTimeDiffQ(q=""){ const s=q.toLowerCase(); return /\b(time\s*difference|difference in time|time offset|offset)\b/.test(s) || (/\bbetween\b/.test(s)&&/\band\b/.test(s)&&/\btime\b/.test(s)) || /\bfrom\s+(gmt|utc)\b/.test(s); }

async function answerTime(q){
  const tz = findTZ(q);
  if (!tz) return json({ message:"Tell me the city (e.g., “time in New York now?”).", mode:"time-need-city", model: OPENAI_MODEL, version:"2.1" });
  let d; try { d = await wta(tz); } catch { d = await tai(tz); }
  const pretty = fmt(d.iso, tz);
  const city = tz.split('/').pop().replace(/_/g,' ');
  return json({ message:`${city}: ${pretty}`, mode:"time-api", model: OPENAI_MODEL, version:"2.1" });
}
function extractZones(q=""){
  const s=q.toLowerCase(); const hits=[];
  for(const k of Object.keys(TZ_MAP).sort((a,b)=>b.length-a.length)){ if(s.includes(k)) hits.push(TZ_MAP[k]); }
  if (/\bgmt\b/.test(s) || /\butc\b/.test(s)) hits.push("Etc/UTC");
  return [...new Set(hits)].slice(0,2);
}
async function answerTimeDiff(q){
  const [aZ,bZ] = extractZones(q);
  if (!aZ || !bZ) return json({ message:"Tell me both places, e.g., “time difference London and New York”.", mode:"time-diff-need-two", model: OPENAI_MODEL, version:"2.1" });
  let a,b; try{ a=await wta(aZ);}catch{a=await tai(aZ);} try{ b=await wta(bZ);}catch{b=await tai(bZ);}
  const aM=offMin(a.offset||"+00:00"), bM=offMin(b.offset||"+00:00");
  const diff=bM-aM, abs=Math.abs(diff), h=Math.floor(abs/60), m=abs%60;
  const dir= diff===0?"the same time as": (diff>0?"ahead of":"behind");
  const span= abs===0?"": (m?`${h}h ${m}m`:`${h}h`);
  const A=aZ.split('/').pop().replace(/_/g,' '), B=bZ.split('/').pop().replace(/_/g,' ');
  const msg= diff===0 ? `${B} is ${dir} ${A}.` : `${B} is ${span} ${dir} ${A}.`;
  return json({ message: msg, mode:"time-diff", model: OPENAI_MODEL, version:"2.1" });
}

/* ---------------- router ---------------- */
async function handle(qRaw, history) {
  const q = (qRaw || "").trim();
  // Real-time utilities first (independent of model cutoff)
  if (isTimeDiffQ(q)) return await answerTimeDiff(q);
  if (isTimeQ(q))     return await answerTime(q);

  // Live web if needed or explicitly requested
  if (wantsWeb(q))    return await webThenLLM(q);

  // Otherwise pure passthrough
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
    return json({ message: "Chat crashed.", error: String(err), mode: "passthrough", model: OPENAI_MODEL, version: "2.1" }, 500);
  }
}
