// /api/ai-tile.js — v2.3 (maps-first + server-provided zoom)
export const config = { runtime: "edge" };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;

const json = (res, status=200) =>
  new Response(JSON.stringify(res), { status, headers: { "Content-Type":"application/json" } });

/* ---------------- Demonyms + helpers ---------------- */
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
function cleanTitle(s){ return s.trim().replace(/\s+/g,' '); }
function isGeneric(s=''){
  const t = s.toLowerCase().trim();
  if (!t || t.length < 2) return true;
  return ["holiday ideas","ideas","holidays","trip","trips","getaway","getaways","weekend"].includes(t);
}

/** Estimate a sensible Google Maps z level. */
function estimateZoom(placeQuery){
  const words = (placeQuery||"").trim().split(/\s+/).length;
  // 1–2 words → likely country/region → wide zoom
  if (words <= 2) return 5;
  // 3+ words → likely city/POI → closer
  return 11;
}

/** Build a Maps search string. If travelish, append hints; else keep toponym clean. */
function buildSpecificMapsQuery(original, { travelish=false } = {}) {
  const raw = (original || "").trim();
  const lower = raw.toLowerCase();
  const country = demonymToCountry(raw);
  const acts = travelish ? extractActivities(lower) : [];

  let base = raw;
  if (country && !new RegExp(`\\b${country}\\b`, "i").test(raw)) base = `${raw} ${country}`;

  const hint = acts.join(" ");
  const out = hint ? `${base} ${hint}` : base;

  return out.trim().replace(/\s+/g, " ");
}

/* ---------------- Recognizers ---------------- */
function detectUrl(q) {
  try {
    const u = new URL(q);
    if (/^https?:$/.test(u.protocol)) {
      return { type:"web", title: u.hostname.replace(/^www\./,''), url: q.trim() };
    }
  } catch {}
  return null;
}

const YT_ID_RE = /^[A-Za-z0-9_-]{8,}$/;
function detectYouTube(q) {
  try {
    const u = new URL(q);
    if (/youtube\.com|youtu\.be/.test(u.hostname)) {
      const id = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
      if (id && YT_ID_RE.test(id)) return { type:"youtube", title:"YouTube", playlist:[id] };
      return { type:"youtube", title:q.trim(), playlist:[] };
    }
  } catch {}
  if (YT_ID_RE.test(q.trim())) return { type:"youtube", title:"YouTube", playlist:[q.trim()] };
  if (/^(youtube|yt)\s+/i.test(q)) return { type:"youtube", title:q.trim(), playlist:[] };
  return null;
}

function detectMarkets(q) {
  const raw = q.trim();
  if (/\b(stocks?|markets?|watchlist|crypto|bitcoin|ethereum)\b/i.test(raw)) {
    const syms = raw.split(/[,\s]+/).filter(s=>/^[A-Z^][A-Z0-9.^-]{0,12}$/.test(s));
    return { type:"stocks", title:"Markets", symbols: syms.length ? syms.slice(0,12) : ["AAPL","MSFT","BTC-USD"] };
  }
  if (/^[A-Z0-9^.-]+(\s*,\s*[A-Z0-9^.-]+){1,}$/i.test(raw)) {
    const syms = raw.split(",").map(s=>s.trim()).filter(Boolean).slice(0,12);
    return { type:"stocks", title:"Markets", symbols: syms };
  }
  return null;
}

function detectGallery(q) {
  if (/\bwallpaper|gallery|photos?|images?\b/i.test(q)) return { type:"gallery", title:q.trim(), images:[] };
  return null;
}

function detectMaps(q) {
  const travelish = /\b(holiday|holidays|getaway|getaways|trip|trips|weekend|resort|hotel|hostel|bnb|city\s*break|safari|tiger|wildlife|trek|hiking|beach|villa|things to do|attractions|national park|near me|in\s+[A-Za-z][\w\s'-]+)\b/i.test(q);
  if (travelish) {
    const qStr = buildSpecificMapsQuery(q, { travelish:true });
    const title = cleanTitle(demonymToCountry(q) || q);
    return { type:"maps", title, q: qStr, zoom: estimateZoom(title) };
  }
  if (looksLikeOnlyPlace(q)) {
    const place = demonymToCountry(q) || q;
    const qStr  = buildSpecificMapsQuery(place, { travelish:false });
    const title = cleanTitle(place);
    return { type:"maps", title, q: qStr, zoom: estimateZoom(title) };
  }
  return null;
}

/* ---------------- OpenAI (fallback) ---------------- */
async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) {
    return (
      detectMaps(prompt) ||
      detectMarkets(prompt) ||
      { type:"rss", title:`Daily Brief — ${prompt.slice(0,32)}`, feeds:[`https://news.google.com/rss/search?q=${encodeURIComponent(prompt)}&hl=en-GB&gl=GB&ceid=GB:en`] }
    );
  }
  const sys = [
    "You map a short user query to ONE dashboard tile.",
    "Return STRICT JSON only. No prose.",
    "Allowed types: maps | web | youtube | rss | gallery | stocks",
    "- maps:   {type, title, q, zoom}",
    "- web:    {type, title, url}",
    "- youtube:{type, title, playlist:[videoId,...]}",
    "- rss:    {type, title, feeds:[url,...]}",
    "- gallery:{type, title, images:[url,...]}",
    "- stocks: {type, title, symbols:[\"AAPL\",\"MSFT\",...]}",
    "Prefer maps for travel words AND for bare place names (1–3 words).",
    "For maps, set a reasonable zoom: country/region ~5, city/POI ~11."
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{ Authorization:`Bearer ${OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify({
      model:"gpt-4o-mini",
      temperature:0.2,
      messages:[{role:"system",content:sys},{role:"user",content:prompt}],
      response_format:{ type:"json_object" }
    })
  });
  if (!res.ok) throw new Error(await res.text().catch(()=> "OpenAI error"));
  const data = await res.json();
  try { return JSON.parse(data?.choices?.[0]?.message?.content || "{}"); } catch { return {}; }
}

/* ---------------- Handler ---------------- */
export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const q = (req.method === "GET") ? (url.searchParams.get("q") || "") : ((await req.json()).q || "");
    const prompt = (q || "").trim();
    if (!prompt) return json({ error: "Missing q" }, 400);

    const heur =
      detectUrl(prompt)    ||
      detectYouTube(prompt)||
      detectMaps(prompt)   ||
      detectMarkets(prompt)||
      detectGallery(prompt);

    let plan = heur || await callOpenAI(prompt);

    if (plan?.type === "maps") {
      // Ensure q and zoom are present/sensible
      const travelish = /\b(holiday|holidays|getaway|getaways|trip|trips|weekend|resort|hotel|hostel|bnb|city\s*break|safari|tiger|wildlife|trek|hiking|beach|villa|things to do|attractions|national park)\b/i.test(prompt);
      const baseTitle = cleanTitle(plan.title || demonymToCountry(prompt) || prompt);
      plan.title = baseTitle;
      const candidateQ = plan.q && !isGeneric(plan.q) ? plan.q : buildSpecificMapsQuery(baseTitle, { travelish });
      plan.q = candidateQ;
      if (typeof plan.zoom !== "number") plan.zoom = estimateZoom(baseTitle);
    }

    if (!plan || !plan.type) {
      plan = { type:"rss", title:`Daily Brief — ${prompt.slice(0,32)}`, feeds:[`https://news.google.com/rss/search?q=${encodeURIComponent(prompt)}&hl=en-GB&gl=GB&ceid=GB:en`] };
    }

    return json({ tile: plan });
  } catch (e) {
    return json({ tile:{ type:"rss", title:"Daily Brief", feeds:["https://feeds.bbci.co.uk/news/rss.xml"] }, error:String(e) }, 200);
  }
}
