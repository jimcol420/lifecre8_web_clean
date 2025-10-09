// /api/ai-tile.js — v2.4 (ideas → RSS/gallery; maps only on explicit map intent)
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

function demonymToCountry(text){
  const l = text.toLowerCase();
  const keys = Object.keys(DEMONYMS).sort((a,b)=>b.length-a.length);
  for (const k of keys) if (l.includes(k)) return DEMONYMS[k];
  return null;
}

function looksLikeOnlyPlace(text){
  return /^[a-z0-9\s'.,-]+$/i.test(text) && text.trim().split(/\s+/).length <= 3;
}
const clean = s => (s||"").trim().replace(/\s+/g," ");

function estimateZoom(place){
  const words = (place||"").trim().split(/\s+/).length;
  return words <= 2 ? 5 : 11; // country/region vs city/POI
}

/* ---------------- Intent detection ---------------- */
function hasExplicitMapIntent(q){
  return /\b(map|maps|near me|directions?|route|navigate|open map)\b/i.test(q);
}
function isHolidayIdeas(q){
  return /\b(holiday|holidays|ideas|inspiration|things to do|attractions|city\s*break|beach(es)?|villa|resort|trek(king)?|safari|wildlife)\b/i.test(q);
}
function isVisualCue(q){
  return /\b(photos?|images?|wallpaper|gallery|inspiration)\b/i.test(q);
}
function isMarketsCue(q){
  return /\b(stocks?|markets?|watchlist|crypto|bitcoin|ethereum)\b/i.test(q) ||
         /^[A-Z0-9^.-]+(\s*,\s*[A-Z0-9^.-]+){1,}$/i.test(q.trim());
}
function isYouTubeCue(q){
  if (/^(youtube|yt)\s+/i.test(q)) return true;
  try{
    const u = new URL(q); return /youtube\.com|youtu\.be/.test(u.hostname);
  }catch{}
  return /^[A-Za-z0-9_-]{8,}$/.test(q.trim());
}
function isUrl(q){
  try{ const u=new URL(q); return /^https?:$/.test(u.protocol); }catch{ return false; }
}

/* ---------------- Heuristic router ---------------- */
function heuristicPlan(q){
  const prompt = clean(q);
  const place = demonymToCountry(prompt) || prompt;

  // 1) Direct URL → web
  if (isUrl(prompt)) {
    const host = prompt.replace(/^https?:\/\/(www\.)?/,'').split('/')[0];
    return { type:"web", title: host || "Web", url: prompt };
  }

  // 2) YouTube
  if (isYouTubeCue(prompt)) {
    // Try to extract ID if it's a URL
    try{
      const u = new URL(prompt);
      const id = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
      if (id) return { type:"youtube", title:"YouTube", playlist:[id] };
    }catch{}
    if (/^[A-Za-z0-9_-]{8,}$/.test(prompt)) return { type:"youtube", title:"YouTube", playlist:[prompt] };
    return { type:"youtube", title:"YouTube", playlist:[] };
  }

  // 3) Markets
  if (isMarketsCue(prompt)) {
    const syms = /^[A-Z0-9^.-]+(\s*,\s*[A-Z0-9^.-]+){1,}$/i.test(prompt)
      ? prompt.split(",").map(s=>s.trim()).slice(0,12)
      : ["AAPL","MSFT","BTC-USD"];
    return { type:"stocks", title:"Markets", symbols: syms };
  }

  // 4) Maps ONLY if explicitly requested (or very obviously a place AND user asked for map)
  if (hasExplicitMapIntent(prompt) || (looksLikeOnlyPlace(prompt) && /\bmap(s)?\b/i.test(prompt))) {
    const title = clean(place);
    return { type:"maps", title, q: title, zoom: estimateZoom(title) };
  }

  // 5) Holiday/ideas/inspiration → RSS first (visually rich via feed thumbnails)
  if (isHolidayIdeas(prompt)) {
    const title = clean(place);
    const qNews = encodeURIComponent(prompt);
    return {
      type:"rss",
      title: `Ideas — ${title}`,
      feeds:[`https://news.google.com/rss/search?q=${qNews}&hl=en-GB&gl=GB&ceid=GB:en`]
    };
  }

  // 6) Visual cue without explicit “map” → gallery
  if (isVisualCue(prompt)) {
    // Client will show the provided URLs if any; we can seed Unsplash source endpoints (no API key needed)
    const qUns = encodeURIComponent(prompt.replace(/\b(photos?|images?|gallery|wallpaper|inspiration)\b/ig,'').trim() || prompt);
    const images = Array.from({length:9}).map((_,i)=>`https://source.unsplash.com/600x600/?${qUns}&sig=${i+1}`);
    return { type:"gallery", title: clean(title || "Gallery"), images };
  }

  // 7) Bare place without ideas → news tile about that place
  if (looksLikeOnlyPlace(prompt)) {
    const title = clean(place);
    return {
      type:"rss",
      title: `Daily Brief — ${title}`,
      feeds:[`https://news.google.com/rss/search?q=${encodeURIComponent(title)}&hl=en-GB&gl=GB&ceid=GB:en`]
    };
  }

  // 8) Default: RSS about the topic
  return {
    type:"rss",
    title:`Daily Brief — ${prompt.slice(0,32)}`,
    feeds:[`https://news.google.com/rss/search?q=${encodeURIComponent(prompt)}&hl=en-GB&gl=GB&ceid=GB:en`]
  };
}

/* ---------------- OpenAI (for ambiguous stuff only) ---------------- */
async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) return heuristicPlan(prompt);

  const sys = [
    "Map a short user query to ONE dashboard tile.",
    "Return STRICT JSON only. No prose.",
    "Allowed types: maps | web | youtube | rss | gallery | stocks",
    "- maps:   {type, title, q, zoom}",
    "- web:    {type, title, url}",
    "- youtube:{type, title, playlist:[videoId,...]}",
    "- rss:    {type, title, feeds:[url,...]}",
    "- gallery:{type, title, images:[url,...]}",
    "- stocks: {type, title, symbols:[\"AAPL\",\"MSFT\",...]}",
    "Rules:",
    "- Use maps ONLY for explicit map intent (\"map\", \"near me\", \"directions\") — NOT for generic holiday ideas.",
    "- Holiday/ideas/inspiration → rss. Prefer short titles like 'Ideas — <Place or Topic>'.",
    "- Visual requests (photos/images/gallery) → gallery with relevant image URLs.",
    "- For maps, set a reasonable zoom (country~5, city/POI~11)."
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

    // Heuristic first; if it returns something sensible, use it.
    const guess = heuristicPlan(prompt);
    let plan = guess && guess.type ? guess : await callOpenAI(prompt);

    // Final safety on maps (ensure zoom present)
    if (plan?.type === "maps") {
      plan.title = plan.title || prompt;
      if (typeof plan.zoom !== "number") plan.zoom = estimateZoom(plan.title);
      if (!plan.q) plan.q = plan.title;
    }

    // Last-resort fallback
    if (!plan || !plan.type) plan = heuristicPlan(prompt);

    return json({ tile: plan });
  } catch (e) {
    return json({ tile: heuristicPlan("news"), error:String(e) }, 200);
  }
}
