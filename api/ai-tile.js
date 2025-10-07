// api/ai-tile.js
export const config = { runtime: "edge" };

/**
 * AI-first tile planner
 * Input:  q (string)
 * Output: { tiles: [ ... ] }
 * 
 * Tile shapes we may return:
 *  - { type:"maps", q, title }
 *  - { type:"web", links:[{title,url,source?}], title }
 *  - { type:"youtube", playlist:[videoId,...], title }
 *  - { type:"rss", feeds:[url,...], title }
 */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;

const SYS = `You generate dashboard tile plans.
- Prefer one strong primary tile; optionally include 1-2 supplement tiles.
- If query is travel-like (holiday, trip, resort, safari, villa, beach, canal boat, city break, weekend getaway, things to do),
  return a "maps" tile with a clear place query. Use demonyms -> country (French->France, Thai->Thailand, South African->South Africa, Argentinian->Argentina).
- If query is a how-to / tutorial, include a "web" tile with 3-6 good links (diverse domains) and, if relevant, a "youtube" tile with 1-3 ids.
- Do NOT include iframes. The client decides rendering.
- Titles must be short and readable.
Return strict JSON only.`;

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function demonymCountry(text) {
  const map = {
    "british":"United Kingdom","english":"England","scottish":"Scotland","welsh":"Wales",
    "irish":"Ireland","french":"France","spanish":"Spain","italian":"Italy","german":"Germany",
    "portuguese":"Portugal","greek":"Greece","turkish":"Turkey","dutch":"Netherlands",
    "swiss":"Switzerland","austrian":"Austria","norwegian":"Norway","swedish":"Sweden",
    "danish":"Denmark","finnish":"Finland","icelandic":"Iceland","moroccan":"Morocco",
    "egyptian":"Egypt","japanese":"Japan","korean":"Korea","vietnamese":"Vietnam",
    "indonesian":"Indonesia","malaysian":"Malaysia","thai":"Thailand","indian":"India",
    "australian":"Australia","new zealand":"New Zealand","polish":"Poland","czech":"Czechia",
    "hungarian":"Hungary","croatian":"Croatia","canadian":"Canada","american":"United States",
    "brazilian":"Brazil","argentinian":"Argentina","chilean":"Chile","south african":"South Africa"
  };
  const lower = text.toLowerCase();
  const keys = Object.keys(map).sort((a,b)=>b.length-a.length);
  for (const k of keys) if (lower.includes(k)) return map[k];
  return null;
}

function heuristicPlan(q) {
  // Fallback when no API key or OpenAI fails
  const t = q.trim();
  const lower = t.toLowerCase();

  const travelRe = /(holiday|holidays|hotel|resort|villa|beach|staycation|weekend|trip|trips|getaway|getaways|things to do|canal\s*boat|safari|city\s*break)/i;
  const ytRe = /(tutorial|how to|build|guide|review|setup|fix|make|learn|walkthrough)/i;

  const tiles = [];

  // Travel?
  if (travelRe.test(lower)) {
    let place = t;
    // If it looks generic, append a location if demonym present.
    const country = demonymCountry(t) || null;
    if (country && !new RegExp(`\\b${country}\\b`, "i").test(place)) {
      place = `${place} ${country}`;
    }
    // If only a bare country/resort-ish, add a hint
    if (!/\b(holiday|trip|ideas|things to do|attractions|resort|hotel|safari|villa|beach|canal boat)\b/i.test(place)) {
      place = `${place} holiday ideas`;
    }
    tiles.push({ type:"maps", q: place, title: `Search — ${t}` });

    // Supplementary web bundle
    const g = `https://www.google.com/search?q=${encodeURIComponent(t)}`;
    const gnews = `https://news.google.com/search?q=${encodeURIComponent(t)}`;
    tiles.push({ type:"web", title:"Results", links:[
      { title:"Top results on Google", url:g, source:"google.com" },
      { title:"News coverage", url:gnews, source:"news.google.com" },
      { title:"Wikipedia overview", url:`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(t)}`, source:"wikipedia.org" }
    ]});
    return { tiles };
  }

  // Tutorials / how-to?
  if (ytRe.test(lower)) {
    const g = `https://www.google.com/search?q=${encodeURIComponent(t)}`;
    const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(t)}`;
    tiles.push({ type:"web", title:`Guides — ${t}`, links:[
      { title:"Google results", url:g, source:"google.com" },
      { title:"YouTube search", url:yt, source:"youtube.com" }
    ]});
    return { tiles };
  }

  // Default: news/topic RSS-ish via Google News (the client will treat it as web tile)
  const g = `https://news.google.com/rss/search?q=${encodeURIComponent(t)}&hl=en-GB&gl=GB&ceid=GB:en`;
  return { tiles:[{ type:"rss", feeds:[g], title:`Daily Brief — ${t}` }] };
}

async function planWithOpenAI(q) {
  if (!OPENAI_API_KEY) return heuristicPlan(q);

  const prompt = [
    { role: "system", content: SYS },
    { role: "user", content: `Query: ${q}\nReturn JSON with a "tiles" array only.` }
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{
      "Authorization":`Bearer ${OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:"gpt-4o-mini",
      messages:prompt,
      temperature:0.2,
      response_format:{ type:"json_object" }
    })
  });

  if (!res.ok) {
    // graceful fallback
    return heuristicPlan(q);
  }

  const data = await res.json();
  let parsed = null;
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  } catch {
    return heuristicPlan(q);
  }

  if (!parsed || !Array.isArray(parsed.tiles) || parsed.tiles.length === 0) {
    return heuristicPlan(q);
  }

  // Light sanitation
  parsed.tiles = parsed.tiles.slice(0, 3).map(t => {
    const out = { ...t };
    if (out.type === "maps" && out.q) {
      // Add helpful hint if it's too bare
      if (/^[A-Za-z\s'-]{3,}$/.test(out.q) && !/\b(holiday|ideas|things to do|attractions|resort|hotel|safari|villa|beach|canal boat)\b/i.test(out.q)) {
        out.q = `${out.q} holiday ideas`;
      }
    }
    if (out.type === "web" && Array.isArray(out.links)) {
      out.links = out.links.filter(l => l && l.url).slice(0, 8);
    }
    if (out.type === "youtube" && Array.isArray(out.playlist)) {
      out.playlist = out.playlist.filter(Boolean).slice(0, 6);
    }
    return out;
  });

  return parsed;
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    if (!q) return jsonResponse({ tiles: [] });

    const plan = await planWithOpenAI(q);
    return jsonResponse(plan);
  } catch (err) {
    return jsonResponse({ tiles: [], error: String(err) }, 500);
  }
}
