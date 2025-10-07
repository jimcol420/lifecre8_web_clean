// api/ai-tile.js
// Edge API — returns a *single* tile plan for the Add Tile box.
// Types returned:
//  - { type:"maps", title, q, related: [{title,url,kind}] }
//  - { type:"results", title, items: [{title,url,kind}] }

export const config = { runtime: "edge" };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;

// --- Demonyms → Countries (longest first) ---
const DEMONYMS = Object.entries({
  "south african": "South Africa",
  argentinian: "Argentina",
  british: "United Kingdom",
  english: "England",
  scottish: "Scotland",
  welsh: "Wales",
  irish: "Ireland",
  french: "France",
  spanish: "Spain",
  italian: "Italy",
  german: "Germany",
  portuguese: "Portugal",
  greek: "Greece",
  turkish: "Turkey",
  dutch: "Netherlands",
  swiss: "Switzerland",
  austrian: "Austria",
  norwegian: "Norway",
  swedish: "Sweden",
  danish: "Denmark",
  finnish: "Finland",
  icelandic: "Iceland",
  moroccan: "Morocco",
  egyptian: "Egypt",
  japanese: "Japan",
  korean: "Korea",
  vietnamese: "Vietnam",
  indonesian: "Indonesia",
  malaysian: "Malaysia",
  thai: "Thailand",
  australian: "Australia",
  "new zealand": "New Zealand",
  polish: "Poland",
  czech: "Czechia",
  hungarian: "Hungary",
  croatian: "Croatia",
  canadian: "Canada",
  american: "United States",
  chilean: "Chile",
  brazilian: "Brazil",
  indian: "India",
}).sort((a, b) => b[0].length - a[0].length); // match longest first

const TRAVEL_WORDS =
  /\b(holiday|holidays|break|breaks|trip|trips|ideas|itinerary|staycation|weekend|getaway|getaways|resort|hotel|hostel|villa|air\s*bnb|airbnb|guesthouse|camp|camping|lodg(e|ing)|yoga|spa|retreat|beach|city\s*break|things to do|attractions|safari|trek|national park|wildlife)\b/i;

const HOWTO_WORDS =
  /\b(how to|how do i|guide|tutorial|plans|blueprint|build|make|craft|step[-\s]?by[-\s]?step|instructions)\b/i;

const NEAR_ME = /\bnear me\b/i;

function demonymToCountry(text) {
  const l = text.toLowerCase();
  for (const [dem, country] of DEMONYMS) {
    if (l.includes(dem)) return country;
  }
  return null;
}

function isBarePlace(text) {
  // short place-ish string (e.g., "Argentina", "French Riviera")
  const words = text.trim().split(/\s+/);
  return /^[a-z0-9\s'.,-]+$/i.test(text) && words.length <= 3;
}

function normaliseTravelQuery(input) {
  let q = input.trim();
  if (!q) return q;
  if (NEAR_ME.test(q)) return q; // don't add country hints

  // demonym → country (do NOT add UK default if we found a country)
  const country = demonymToCountry(q);
  if (country && !new RegExp(`\\b${country}\\b`, "i").test(q)) {
    q = `${q} ${country}`;
  }

  // If it's only a place name, give Maps a helpful topic
  if (isBarePlace(q) && !/\b(holiday|trip|ideas|attractions|things to do|safari|trek|villa|beach|resort)\b/i.test(q)) {
    q = `${q} holiday ideas`;
  }

  // Safari / trek: strengthen query to avoid world map
  if (/\b(safari|tiger|wildlife|game drive|trek)\b/i.test(input)) {
    // try to retrieve the country we inferred (or default to input)
    const c = country || input;
    q = `${c} safari trek national parks wildlife holiday ideas`.trim();
  }

  return q;
}

function relatedForMaps(q) {
  const g = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const wikiSeed = q.replace(/(holiday ideas|things to do|attractions|resort|hotel|villa)/gi, "").trim();
  const wk = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(wikiSeed)}`;
  return [
    { kind: "search", title: "Top results on Google", url: g },
    { kind: "youtube", title: "Watch on YouTube", url: yt },
    { kind: "wiki", title: "Wikipedia overview", url: wk },
  ];
}

function resultsForGeneric(query) {
  // Curated high-signal jump-offs (no scraping needed)
  const g = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const wk = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`;
  return [
    { kind: "youtube", title: "Watch on YouTube", url: yt },
    { kind: "guide", title: "Top results on Google", url: g },
    { kind: "wiki", title: "Wikipedia overview", url: wk },
  ];
}

async function llmSuggestPlan(text) {
  // Optional: let the model refine the intent (kept conservative).
  const key = OPENAI_API_KEY;
  if (!key) return null;
  const prompt = [
    { role: "system", content: "You return one JSON object. Detect if a user's query is TRAVEL or HOWTO. Reply with {intent:'travel'|'howto'|'generic', topic:string}. Be conservative. No prose." },
    { role: "user", content: text },
  ];
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: prompt, temperature: 0 }),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  const content = j?.choices?.[0]?.message?.content ?? "";
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj === "object") return obj;
  } catch {}
  return null;
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();

    if (!q) {
      return new Response(
        JSON.stringify({ tile: { type: "results", title: "Results — (empty)", items: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1) Heuristics first
    const looksTravel = TRAVEL_WORDS.test(q) || demonymToCountry(q);
    const looksHowTo = HOWTO_WORDS.test(q);

    // 2) Optional LLM nudge (only to refine)
    let llm = null;
    try {
      llm = await llmSuggestPlan(q);
    } catch {}

    const intent =
      (llm?.intent === "travel" && "travel") ||
      (llm?.intent === "howto" && "howto") ||
      (llm?.intent === "generic" && "generic") ||
      (looksTravel ? "travel" : looksHowTo ? "howto" : "generic");

    if (intent === "travel") {
      const nq = normaliseTravelQuery(q);
      return new Response(
        JSON.stringify({
          tile: {
            type: "maps",
            title: `Search — ${q}`,
            q: nq,
            related: relatedForMaps(nq),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // howto/generic → results list (multi-link, no iframes)
    const items = resultsForGeneric(q);
    return new Response(
      JSON.stringify({
        tile: {
          type: "results",
          title: q.replace(/^([a-z])/i, (m) => m.toUpperCase()),
          items,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
