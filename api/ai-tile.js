// /api/ai-tile.js
// Edge function that turns a free-form query into a concrete tile plan.
// It returns a single tile JSON the client can render immediately.

export const config = { runtime: "edge" };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;

// --- helpers ---------------------------------------------------------------

function json(res, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DEMONYMS = {
  "british":"United Kingdom","english":"England","scottish":"Scotland","welsh":"Wales","irish":"Ireland",
  "french":"France","spanish":"Spain","italian":"Italy","german":"Germany","portuguese":"Portugal",
  "thai":"Thailand","greek":"Greece","turkish":"Turkey","dutch":"Netherlands","swiss":"Switzerland",
  "austrian":"Austria","norwegian":"Norway","swedish":"Sweden","danish":"Denmark","finnish":"Finland",
  "icelandic":"Iceland","moroccan":"Morocco","egyptian":"Egypt","japanese":"Japan","korean":"Korea",
  "vietnamese":"Vietnam","indonesian":"Indonesia","malaysian":"Malaysia","australian":"Australia",
  "new zealand":"New Zealand","polish":"Poland","czech":"Czechia","hungarian":"Hungary","croatian":"Croatia",
  "canadian":"Canada","american":"United States","chilean":"Chile","argentinian":"Argentina","brazilian":"Brazil",
  "south african":"South Africa"
};

function demonymToCountry(text){
  const l = text.toLowerCase();
  const keys = Object.keys(DEMONYMS).sort((a,b)=>b.length-a.length);
  for (const k of keys) if (l.includes(k)) return DEMONYMS[k];
  return null;
}

function normalizeTravelQuery(q) {
  const raw = (q || "").trim();
  if (!raw) return raw;

  // "south african safari" -> "... South Africa"
  const country = demonymToCountry(raw);
  let out = raw;
  if (country && !new RegExp(`\\b${country}\\b`, "i").test(raw)) out = `${raw} ${country}`;

  // Bare place name → add useful hint so Maps isn't world-zoomed
  const looksLikeOnlyPlace = /^[a-z0-9\s'.,-]+$/i.test(out) && out.trim().split(/\s+/).length <= 3;
  if (looksLikeOnlyPlace && !/\b(holiday|trip|ideas|things to do|attractions|safari|beach|villa|resort|hotel)\b/i.test(out)) {
    out = `${out} holiday ideas`;
  }
  return out;
}

// --- OpenAI call -----------------------------------------------------------

async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) {
    // demo response to avoid hard-failing locally
    return {
      type: "rss",
      title: `Daily Brief — ${prompt.slice(0, 32)}`.trim(),
      feeds: [
        `https://news.google.com/rss/search?q=${encodeURIComponent(prompt)}&hl=en-GB&gl=GB&ceid=GB:en`
      ]
    };
  }

  const sys = [
    "You are an agent that maps a user's short query to ONE dashboard tile.",
    "Return STRICT JSON with keys appropriate to the chosen type, no commentary.",
    "TYPES you may choose: maps | web | youtube | rss | gallery | stocks",
    "",
    "Schemas:",
    "- maps:   {type, title, q}",
    "- web:    {type, title, url}",
    "- youtube:{type, title, playlist:[videoId,...]}",
    "- rss:    {type, title, feeds:[url,...]}",
    "- gallery:{type, title, images:[url,...]}",
    "- stocks: {type, title, symbols:[\"AAPL\",\"MSFT\",...]}",
    "",
    "Rules:",
    "- For travel (holiday, getaway, safari, villa, beach, city break, etc.) choose 'maps'.",
    "- Use demonyms: 'South African' -> 'South Africa', 'French' -> 'France', etc.",
    "- If the user just gives a place name (e.g., 'Argentina'), append a useful hint like 'holiday ideas'.",
    "- For how-to, 'why do', or topic queries with no clear site → choose 'rss' using a Google News query.",
    "- For explicit URLs, choose 'web' and pass the URL.",
    "- For 'YouTube' words or youtu* links → 'youtube' and include a small playlist (IDs only).",
    "- Keep titles short, sentence case.",
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error(`OpenAI failed: ${txt}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try { parsed = JSON.parse(content); } catch { parsed = {}; }
  return parsed;
}

// --- handler ---------------------------------------------------------------

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const q = (req.method === "GET")
      ? (url.searchParams.get("q") || "")
      : ((await req.json()).q || "");

    const prompt = q.trim();
    if (!prompt) return json({ error: "Missing q" }, 400);

    // quick pre-normalization for obvious travel cases
    const looksTravel = /\b(holiday|holidays|getaway|getaways|trip|trips|weekend|resort|hotel|hostel|bnb|city\s*break|safari|beach|villa|itinerary|things to do)\b/i.test(prompt)
      || /\b(near me|in\s+[A-Za-z][\w\s'-]+)$/i.test(prompt);
    const normalized = looksTravel ? normalizeTravelQuery(prompt) : prompt;

    // Pass normalized text to the model so it chooses best tile type
    const plan = await callOpenAI(normalized);

    // Final safety: coerce maps.q to the normalized string if missing
    if (plan?.type === "maps" && !plan.q) plan.q = normalized;

    return json({ tile: plan });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
