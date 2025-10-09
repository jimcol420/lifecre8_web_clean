// /api/ai-tile.js — v2.1 "hybrid router"
// 1) Heuristics-first (URL, YouTube, Maps/travel, Stocks/Crypto, Gallery-ish)
// 2) Falls back to OpenAI only when ambiguous
// 3) If no OPENAI_API_KEY, still returns a *reasonable* tile (not always RSS)

export const config = { runtime: "edge" };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;

/* ---------- utilities ---------- */
const json = (res, status=200) =>
  new Response(JSON.stringify(res), { status, headers: { "Content-Type":"application/json" } });

const isStr = v => typeof v === "string" && v.trim().length > 0;
const hostOf = (u)=>{ try{return new URL(u).hostname.replace(/^www\./,'');}catch{return'';} };
const asUrl  = (s)=>{ try{ return new URL(s); }catch{ return null; } };

/* ---------- demonyms & hints (from your previous version) ---------- */
const DEMONYMS = {
  "british":"United Kingdom","english":"England","scottish":"Scotland","welsh":"Wales","irish":"Ireland",
  "french":"France","spanish":"Spain","italian":"Italy","german":"Germany","portuguese":"Portugal",
  "thai":"Thailand","greek":"Greece","turkish":"Turkey","dutch":"Netherlands","swiss":"Switzerland",
  "austrian":"Austria","norwegian":"Norway","swedish":"Sweden","danish":"Denmark","finnish":"Finland",
  "icelandic":"Iceland","moroccan":"Morocco","egyptian":"Egypt","japanese":"Japan","korean":"Korea",
  "vietnamese":"Vietnam","indonesian":"Indonesia","malaysian":"Malaysia","australian":"Australia",
  "new zealand":"New Zealand","polish":"Poland","czech":"Czechia","hungarian":"Hungary","croatian":"Croatia",
  "canadian":"Canada","american":"United States","chilean":"Chile","argentinian":"Argentina","brazilian":"Brazil",
  "south african":"South Africa","indian":"India"
};
const ACTIVITY_HINTS = [
  "holiday ideas","holidays","trip","trips","getaway","getaways","weekend",
  "things to do","attractions","resort","resorts","hotel","hotels",
  "villa","villas","beach","beaches","city break","city breaks",
  "safari","tiger safari","wildlife","national park","game drive","trek","trekking","hiking"
];

function demonymToCountry(text){
  const l = text.toLowerCase();
  const keys = Object.keys(DEMONYMS).sort((a,b)=>b.length-a.length);
  for (const k of keys) if (l.includes(k)) return DEMONYMS[k];
  return null;
}
function extractActivities(qLower){
  const hits = [];
  for (const a of ACTIVITY_HINTS) if (qLower.includes(a)) hits.push(a);
  if (qLower.includes("tiger") && !hits.some(x=>x.includes("tiger"))) hits.push("tiger safari");
  if (qLower.includes("safari") && !hits.includes("safari")) hits.push("safari");
  if (qLower.includes("trek")) hits.push("trek");
  return Array.from(new Set(hits));
}
function looksLikeOnlyPlace(text){
  return /^[a-z0-9\s'.,-]+$/i.test(text) && text.trim().split(/\s+/).length <= 3;
}
function buildSpecificMapsQuery(original) {
  const raw = (original || "").trim();
  const lower = raw.toLowerCase();
  const country = demonymToCountry(raw);
  const acts = extractActivities(lower);
  let base = raw;
  if (country && !new RegExp(`\\b${country}\\b`, "i").test(raw)) base = `${raw} ${country}`;
  if (looksLikeOnlyPlace(base) && acts.length === 0) acts.push("holiday ideas");
  const hint = acts.join(" ");
  const out = hint ? `${base} ${hint}` : base;
  return out.trim().replace(/\s+/g, " ");
}
function isGeneric(s=''){
  const t = s.toLowerCase().trim();
  if (!t || t.length < 6) return true;
  return ["holiday ideas","ideas","holidays","trip","trips","getaway","getaways","weekend"].includes(t);
}

/* ---------- recognizers (deterministic) ---------- */
// 1) Direct URL → web
function detectUrl(q) {
  const u = asUrl(q);
  if (u && /^https?:$/.test(u.protocol)) {
    return { type:"web", title: hostOf(q) || "Web", url: q.trim() };
  }
  return null;
}
// 2) YouTube (url or bare ID or search cue)
const YT_ID_RE = /^[A-Za-z0-9_-]{8,}$/;
function detectYouTube(q) {
  const u = asUrl(q);
  if (u && /youtube\.com|youtu\.be/.test(u.hostname)) {
    const id = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
    if (id && YT_ID_RE.test(id)) return { type:"youtube", title:"YouTube", playlist:[id] };
    return { type:"youtube", title:q.trim(), playlist:[] }; // let client show default list
  }
  if (YT_ID_RE.test(q.trim())) return { type:"youtube", title:"YouTube", playlist:[q.trim()] };
  if (/^(youtube|yt)\s+/i.test(q)) return { type:"youtube", title:q.trim(), playlist:[] };
  return null;
}
// 3) Travel / maps
function detectMaps(q) {
  const travelish = /\b(holiday|holidays|getaway|getaways|trip|trips|weekend|resort|hotel|hostel|bnb|city\s*break|safari|tiger|wildlife|trek|hiking|beach|villa|things to do|attractions|national park|near me|in\s+[A-Za-z][\w\s'-]+)\b/i.test(q);
  if (!travelish) return null;
  const mapQ = buildSpecificMapsQuery(q);
  return { type:"maps", title:`Search — ${q}`, q: mapQ };
}
// 4) Stocks / Crypto
function detectMarkets(q) {
  const raw = q.trim();
  // Common cues
  if (/\b(stocks?|markets?|watchlist|crypto|bitcoin|ethereum)\b/i.test(raw)) {
    // try to parse comma-separated tickers, else just show presets
    const syms = raw.split(/[,\s]+/).filter(s=>/^[A-Z^][A-Z0-9.^-]{0,12}$/.test(s));
    if (syms.length) return { type:"stocks", title:"Markets", symbols: syms.slice(0,12) };
    return { type:"stocks", title:"Markets", symbols:["AAPL","MSFT","BTC-USD"] };
  }
  // Uppercase comma list e.g. "AAPL, MSFT, ^GSPC" or symbols with -USD
  if (/^[A-Z0-9^.-]+(\s*,\s*[A-Z0-9^.-]+){1,}$/i.test(raw)) {
    const syms = raw.split(",").map(s=>s.trim()).filter(Boolean).slice(0,12);
    return { type:"stocks", title:"Markets", symbols: syms };
  }
  return null;
}
// 5) Image-y cue → gallery
function detectGallery(q) {
  if (/\bwallpaper|gallery|photos?|images?\b/i.test(q)) {
    return { type:"gallery", title: q.trim(), images: [] };
  }
  return null;
}

/* ---------- OpenAI fallback (only if needed) ---------- */
async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) {
    // No key → choose a sensible deterministic fallback
    // If travelish, map; if symbol-ish, stocks; else RSS.
    const m = detectMaps(prompt) || detectMarkets(prompt) || null;
    if (m) return m;
    return {
      type: "rss",
      title: `Daily Brief — ${prompt.slice(0, 32)}`.trim(),
      feeds: [
        `https://news.google.com/rss/search?q=${encodeURIComponent(prompt)}&hl=en-GB&gl=GB&ceid=GB:en`
      ]
    };
  }

  const sys = [
    "You map a short user query to ONE dashboard tile.",
    "Return STRICT JSON only. No prose.",
    "Allowed types: maps | web | youtube | rss | gallery | stocks",
    "",
    "Schemas:",
    "- maps:   {type, title, q}",
    "- web:    {type, title, url}",
    "- youtube:{type, title, playlist:[videoId,...]}",
    "- rss:    {type, title, feeds:[url,...]}",
    "- gallery:{type, title, images:[url,...]}",
    "- stocks: {type, title, symbols:[\"AAPL\",\"MSFT\",...]}",
    "",
    "Guidance:",
    "- Travel words (holiday, safari, trek, villa, beach, city break, things to do, etc.) → maps.",
    "- Respect demonyms: French→France, Indian→India, South African→South Africa.",
    "- Keep titles short."
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [{ role:"system", content: sys }, { role:"user", content: prompt }],
      response_format: { type:"json_object" }
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error(`OpenAI failed: ${txt}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(content); } catch { return {}; }
}

/* ---------- handler ---------- */
export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const q = (req.method === "GET")
      ? (url.searchParams.get("q") || "")
      : ((await req.json()).q || "");
    const prompt = (q || "").trim();
    if (!prompt) return json({ error: "Missing q" }, 400);

    // Heuristics first
    const heur =
      detectUrl(prompt)    ||
      detectYouTube(prompt)||
      detectMaps(prompt)   ||
      detectMarkets(prompt)||
      detectGallery(prompt);

    if (heur && heur.type) {
      // Harden maps q
      if (heur.type === "maps") {
        if (!heur.q || isGeneric(heur.q)) heur.q = buildSpecificMapsQuery(prompt);
        if (!heur.title) heur.title = `Search — ${prompt}`;
      }
      return json({ tile: heur });
    }

    // Ambiguous → call OpenAI; fall back deterministically if needed
    let plan = await callOpenAI(prompt);

    if (plan?.type === "maps") {
      const qCandidate = plan.q && !isGeneric(plan.q) ? plan.q : buildSpecificMapsQuery(prompt);
      plan.q = qCandidate;
      if (!plan.title) plan.title = `Search — ${prompt}`;
    }

    // Last-resort RSS for anything still empty
    if (!plan || !plan.type) {
      plan = {
        type: "rss",
        title: `Daily Brief — ${prompt.slice(0,32)}`.trim(),
        feeds: [`https://news.google.com/rss/search?q=${encodeURIComponent(prompt)}&hl=en-GB&gl=GB&ceid=GB:en`]
      };
    }
    return json({ tile: plan });
  } catch (e) {
    // Safe fallback
    return json({
      tile: {
        type: "rss",
        title: "Daily Brief",
        feeds: ["https://feeds.bbci.co.uk/news/rss.xml"]
      },
      error: String(e)
    }, 200);
  }
}
