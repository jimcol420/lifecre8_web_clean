// /api/ai-tile.js — v2.5 (ideas → RSS/gallery; maps only on explicit map intent)
export const config = { runtime: "edge" };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

const json = (res, status=200) =>
  new Response(JSON.stringify(res), { status, headers: { "Content-Type":"application/json" } });

/* -------- helpers -------- */
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
const clean = s => (s||"").trim().replace(/\s+/g," ");
const demonymToCountry = t => {
  const l=(t||"").toLowerCase();
  const keys = Object.keys(DEMONYMS).sort((a,b)=>b.length-a.length);
  for (const k of keys) if (l.includes(k)) return DEMONYMS[k];
  return null;
};
const looksLikeOnlyPlace = txt => /^[a-z0-9\s'.,-]+$/i.test(txt||"") && clean(txt).split(/\s+/).length <= 3;
const hostOf = (u)=>{ try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ""; } };
const isUrl = (q)=>{ try{ const u=new URL(q); return /^https?:$/.test(u.protocol);}catch{ return false;} };
const YT_ID_RE = /^[A-Za-z0-9_-]{8,}$/;

/* -------- intents -------- */
const explicitMap = q => /\b(map|maps|near me|directions?|route|navigate|open map)\b/i.test(q);
const holidayIdeas = q => /\b(holiday|holidays|ideas|inspiration|things to do|attractions|city\s*break|beach(es)?|villa|resort|trek(king)?|safari|wildlife)\b/i.test(q);
const visualCue    = q => /\b(photos?|images?|wallpaper|gallery|inspiration)\b/i.test(q);
const marketsCue   = q => /\b(stocks?|markets?|watchlist|crypto|bitcoin|ethereum)\b/i.test(q) ||
                           /^[A-Z0-9^.-]+(\s*,\s*[A-Z0-9^.-]+){1,}$/i.test((q||"").trim());
const youtubeCue   = q => {
  if (/^(youtube|yt)\s+/i.test(q||"")) return true;
  try { const u=new URL(q); if (/youtube\.com|youtu\.be/.test(u.hostname)) return true; } catch {}
  return YT_ID_RE.test((q||"").trim());
};

/* -------- search enhancer (optional) -------- */
async function tavilySuggestTopic(q){
  if (!TAVILY_API_KEY) return q;
  try {
    const r = await fetch("https://api.tavily.com/search", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization": `Bearer ${TAVILY_API_KEY}` },
      body: JSON.stringify({ query: q, max_results: 3 })
    });
    if (!r.ok) return q;
    const j = await r.json().catch(()=>null);
    const top = j?.results?.[0]?.title || "";
    // If Tavily yields a clearer phrasing, blend it
    if (top && top.length > 6) return `${q} ${top}`.slice(0, 140);
    return q;
  } catch { return q; }
}

/* -------- builder -------- */
function estimateZoom(place){ return (clean(place).split(/\s+/).length <= 2) ? 5 : 11; }

function planGallery(title, query){
  const qUns = encodeURIComponent(query || title || "travel");
  const images = Array.from({length:9}).map((_,i)=>`https://source.unsplash.com/600x600/?${qUns}&sig=${i+1}`);
  return { type:"gallery", title: title || "Gallery", images };
}

function heuristicPlan(q){
  const prompt = clean(q);
  const place = demonymToCountry(prompt) || prompt;

  // 1) Web
  if (isUrl(prompt)) return { type:"web", title: hostOf(prompt) || "Web", url: prompt };

  // 2) YouTube
  if (youtubeCue(prompt)) {
    try{
      const u = new URL(prompt);
      const id = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
      if (id && YT_ID_RE.test(id)) return { type:"youtube", title:"YouTube", playlist:[id] };
    } catch {}
    if (YT_ID_RE.test(prompt)) return { type:"youtube", title:"YouTube", playlist:[prompt] };
    return { type:"youtube", title:"YouTube", playlist:[] };
  }

  // 3) Markets
  if (marketsCue(prompt)) {
    const syms = /^[A-Z0-9^.-]+(\s*,\s*[A-Z0-9^.-]+){1,}$/i.test(prompt)
      ? prompt.split(",").map(s=>s.trim()).slice(0,12)
      : ["AAPL","MSFT","BTC-USD"];
    return { type:"stocks", title:"Markets", symbols: syms };
  }

  // 4) Maps only on explicit intent
  if (explicitMap(prompt) || (looksLikeOnlyPlace(prompt) && /\bmap(s)?\b/i.test(prompt))) {
    const title = clean(place);
    return { type:"maps", title, q: title, zoom: estimateZoom(title) };
  }

  // 5) Ideas → RSS (image-rich), optionally Gallery if visual
  if (holidayIdeas(prompt)) {
    const title = clean(place);
    const feedQ = encodeURIComponent(prompt);
    return {
      type: "rss",
      title: `Ideas — ${title}`,
      feeds: [`https://news.google.com/rss/search?q=${feedQ}&hl=en-GB&gl=GB&ceid=GB:en`],
      // Hint to client that a gallery would be nice
      _suggestGallery: visualCue(prompt)
    };
  }

  // 6) Pure place → news about place
  if (looksLikeOnlyPlace(prompt)) {
    const title = clean(place);
    return {
      type:"rss",
      title:`Daily Brief — ${title}`,
      feeds:[`https://news.google.com/rss/search?q=${encodeURIComponent(title)}&hl=en-GB&gl=GB&ceid=GB:en`]
    };
  }

  // 7) Default topic → RSS
  return {
    type:"rss",
    title:`Daily Brief — ${prompt.slice(0,32)}`,
    feeds:[`https://news.google.com/rss/search?q=${encodeURIComponent(prompt)}&hl=en-GB&gl=GB&ceid=GB:en`]
  };
}

/* -------- OpenAI (only for ambiguous) -------- */
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
    "- Use maps ONLY for explicit map intent (\"map\", \"near me\", \"directions\").",
    "- Holiday/ideas/inspiration → rss (short title 'Ideas — <Place/Topic>').",
    "- If request sounds visual (photos/images/gallery), prefer gallery with relevant images.",
    "- For maps, set zoom ~5 (country/region) or ~11 (city/POI)."
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

/* -------- handler -------- */
export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const q = (req.method === "GET") ? (url.searchParams.get("q") || "") : ((await req.json()).q || "");
    const prompt = (q || "").trim();
    if (!prompt) return json({ error: "Missing q" }, 400);

    // Heuristic first
    let plan = heuristicPlan(prompt);

    // Small “live” boost for ideas: blend Tavily top title into the feed query (if key present)
    if (plan.type === "rss" && /^ideas — /i.test(plan.title)) {
      const better = await tavilySuggestTopic(prompt);
      plan.feeds = [`https://news.google.com/rss/search?q=${encodeURIComponent(better)}&hl=en-GB&gl=GB&ceid=GB:en`];
    }

    // Ambiguous? ask the model
    if (!plan || !plan.type) plan = await callOpenAI(prompt);

    // Final safety for maps
    if (plan?.type === "maps") {
      plan.title = plan.title || prompt;
      if (typeof plan.zoom !== "number") plan.zoom = estimateZoom(plan.title);
      if (!plan.q) plan.q = plan.title;
    }

    return json({ tile: plan, version:"2.5" });
  } catch (e) {
    return json({ tile: heuristicPlan("news"), error:String(e), version:"2.5" }, 200);
  }
}
