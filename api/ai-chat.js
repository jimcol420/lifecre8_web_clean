// /api/ai-chat.js — v1.6
// - Correct timezone formatting via Intl.DateTimeFormat({ timeZone })
// - Dual time providers with timeout (WorldTimeAPI -> TimeAPI.io) before any web fallback
// - Deterministic capability reply
// - Web lookups on GET/POST when needed
// - Returns {message, mode, version}

export const config = { runtime: "edge" };

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_API_KEY ||
  process.env.OPENAI_KEY;

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

/* ---------- shared ---------- */
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
const json = (o, s=200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type":"application/json" } });

/* ---------- intent ---------- */
function needsWeb(q = "") {
  const s = q.toLowerCase().trim();
  if (/^\/search\s+/.test(s)) return true;
  if (/\b(latest|today|this week|this month|breaking|update|news|score|fixtures|schedule|price now|live price|live score)\b/.test(s)) return true;
  if (/\b20(2[3-9]|3\d)\b/.test(s)) return true;
  return false;
}
function isCapabilityQ(q=""){ return /\b(connected to (the )?internet|live internet|do you browse|can you browse|are you online)\b/i.test(q); }
function isTimeQ(q=""){ return /\b(time\s+(in|at)\s+\S+|what(?:'| i)?s the time\b|current time|time now|right now)\b/i.test(q); }

/* ---------- capability ---------- */
function capabilityAnswer(){
  if (TAVILY_API_KEY) return json({ message:"Yes — I can do live web lookups when needed (e.g., “today”, “latest”) or if you use /search.", mode:"capability", version:"1.6" });
  return json({ message:"I can answer normally. To enable live web lookups, add TAVILY_API_KEY on the server.", mode:"capability-no-search-key", version:"1.6" });
}

/* ---------- time helpers ---------- */
const TZ_MAP = {
  "new york":"America/New_York","nyc":"America/New_York",
  "los angeles":"America/Los_Angeles","la ":"America/Los_Angeles","san francisco":"America/Los_Angeles",
  "chicago":"America/Chicago","toronto":"America/Toronto",
  "london":"Europe/London","paris":"Europe/Paris","berlin":"Europe/Berlin","madrid":"Europe/Madrid","rome":"Europe/Rome",
  "istanbul":"Europe/Istanbul","dubai":"Asia/Dubai",
  "mumbai":"Asia/Kolkata","delhi":"Asia/Kolkata","bangalore":"Asia/Kolkata",
  "tokyo":"Asia/Tokyo","sydney":"Australia/Sydney","auckland":"Pacific/Auckland",
  "singapore":"Asia/Singapore","hong kong":"Asia/Hong_Kong"
};
function guessTZ(q=""){
  const s = q.toLowerCase();
  const keys = Object.keys(TZ_MAP).sort((a,b)=>b.length-a.length);
  for (const k of keys) if (s.includes(k)) return TZ_MAP[k];
  return null;
}
const abortableFetch = (input, init={}, ms=2500) => {
  const c = new AbortController();
  const t = setTimeout(()=>c.abort(), ms);
  return fetch(input, { ...init, signal:c.signal }).finally(()=>clearTimeout(t));
};
async function fetchWorldTime(tz){
  const r = await abortableFetch(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`, { headers:{ "cache-control":"no-cache" }});
  if (!r.ok) throw new Error(`wta ${r.status}`);
  const j = await r.json();
  return { iso: j.datetime, utcOffset: j.utc_offset }; // iso in that tz offset
}
async function fetchTimeApiIO(tz){
  const r = await abortableFetch(`https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(tz)}`, { headers:{ "cache-control":"no-cache" }});
  if (!r.ok) throw new Error(`tai ${r.status}`);
  const j = await r.json();
  // Build ISO with offset if provided; fallback compose
  if (j?.dateTime) return { iso: j.dateTime, utcOffset: j?.timeZone?.utcOffset || "" };
  // fallback combine date + time
  const iso = `${j.year}-${String(j.month).padStart(2,"0")}-${String(j.day).padStart(2,"0")}T${j.time ?? "00:00:00"}`;
  return { iso, utcOffset: "" };
}
function formatInZone(iso, tz){
  // Format in the requested timeZone (do not convert to user’s local zone)
  const dt = new Date(iso);
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone: tz, hour:'numeric', minute:'2-digit',
    weekday:'long', month:'short', day:'numeric', timeZoneName:'short'
  });
  return fmt.format(dt);
}
async function answerTime(q){
  const tz = guessTZ(q);
  if (!tz) return json({ message:"Tell me the city (e.g., “time in New York now?”) and I’ll give you the exact local time.", mode:"time-need-city", version:"1.6" });

  try {
    let data;
    try { data = await fetchWorldTime(tz); }
    catch { data = await fetchTimeApiIO(tz); }
    const pretty = formatInZone(data.iso, tz); // guaranteed shown in target TZ
    const city = tz.split('/').pop().replace(/_/g,' ');
    return json({ message:`${city}: ${pretty}`, mode:"time-api", version:"1.6" });
  } catch {
    // last resort: still try web+llm
    return await answerWithWebThenLLM(`current local time in ${tz}`);
  }
}

/* ---------- web search ---------- */
async function webSearch(query){
  if (!TAVILY_API_KEY) return { ok:false, reason:"no-key", results:[] };
  const res = await fetch("https://api.tavily.com/search", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization": `Bearer ${TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 5 })
  });
  if (!res.ok) return { ok:false, reason:`http ${res.status}`, results:[] };
  const j = await res.json().catch(()=>null);
  const results = j?.results?.map(r=>({ title:r.title, url:r.url, snippet:r.content })).slice(0,5) || [];
  return { ok:true, results };
}
async function callOpenAI(messages, mode="llm-only"){
  if (!OPENAI_API_KEY) return json({ message:"Chat is running in demo mode (no OPENAI_API_KEY set).", mode:"llm-demo", version:"1.6" });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{ Authorization:`Bearer ${OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify({ model:"gpt-4o-mini", messages, temperature:0.3 })
  });
  if (!res.ok) {
    const detail = await res.text().catch(()=> "");
    return json({ message:"Chat failed.", detail, mode, version:"1.6" }, 500);
  }
  const data = await res.json().catch(()=>null);
  const message = data?.choices?.[0]?.message?.content?.trim() || "I couldn't generate a reply just now.";
  return json({ message, mode, version:"1.6" });
}
async function answerWithWebThenLLM(query){
  const web = await webSearch(query);
  if (web.ok && web.results.length) {
    const ctx = web.results.map((r,i)=>`[${i+1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
    const msgs = [
      { role:"system", content:"Summarize briefly and cite with [1], [2]. If asked for actions, use short bullets." },
      { role:"user", content:`Question: ${query}\n\nSources:\n${ctx}` }
    ];
    const r = await callOpenAI(msgs, "web+llm");
    const b = await r.json();
    return json({ message:b.message, mode:"web+llm", version:"1.6" });
  }
  if (!web.ok && web.reason === "no-key") return json({ message:"Web search is not enabled on this server (missing TAVILY_API_KEY).", mode:"llm-no-search-key", version:"1.6" });
  // failed search; LLM only
  const msgs = toOpenAIMessages([], query);
  return await callOpenAI(msgs, "llm-only");
}

/* ---------- router ---------- */
async function handleQuery(qRaw, history, forceWeb=false){
  const q = (qRaw || "").trim();
  if (isCapabilityQ(q)) return capabilityAnswer();
  if (isTimeQ(q)) return await answerTime(q);
  const wantsWeb = forceWeb || needsWeb(q);
  if (wantsWeb && OPENAI_API_KEY) {
    const query = q.replace(/^\/search\s+/i,'').trim() || q;
    return await answerWithWebThenLLM(query);
  }
  const msgs = toOpenAIMessages(Array.isArray(history)?history:[], q);
  return await callOpenAI(msgs, "llm-only");
}

export default async function handler(req) {
  try {
    if (req.method === "POST") {
      const { q, messages: history, forceWeb } = await req.json();
      return await handleQuery(q, history, !!forceWeb);
    }
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const forceWeb = (searchParams.get("mode") || "").toLowerCase() === "web";
    return await handleQuery(q, [], forceWeb);
  } catch (err) {
    return json({ message:"Chat crashed.", error:String(err), version:"1.6" }, 500);
  }
}
