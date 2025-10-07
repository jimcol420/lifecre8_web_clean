// /api/ai-tile.js
// Edge function that converts a free-form query into ONE tile plan.

export const config = { runtime: "edge" };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;

function json(res, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

const ACTIVITY_HINTS = [
  "holiday ideas","holidays","trip","trips","getaway","getaways","weekend",
  "things to do","attractions","resort","resorts","hotel","hotels",
  "villa","villas","beach","beaches","city break","city breaks",
  // safari-ish
  "safari","tiger safari","wildlife","national park","game drive","trek","trekking","hiking"
];

function extractActivities(qLower){
  const hits = [];
  for (const a of ACTIVITY_HINTS) {
    if (qLower.includes(a)) hits.push(a);
  }
  // promote tiger -> tiger safari
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

  // If user gave only a place name, add a meaningful hint
  if (looksLikeOnlyPlace(base) && acts.length === 0) acts.push("holiday ideas");

  // Compose
  const hint = acts.join(" ");
  const out = hint ? `${base} ${hint}` : base;

  return out.trim().replace(/\s+/g, " ");
}

function isGeneric(str){
  const s = (str || "").toLowerCase().trim();
  if (!s) return true;
  if (s.length < 6) return true;
  return ["holiday ideas","ideas","holidays","trip","trips","getaway","getaways","weekend"]
    .includes(s);
}

/* ---------------- OpenAI call ---------------- */
async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) {
    // demo
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
    "- Keep titles short.",
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

/* ---------------- Handler ---------------- */
export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const q = (req.method === "GET")
      ? (url.searchParams.get("q") || "")
      : ((await req.json()).q || "");

    const prompt = q.trim();
    if (!prompt) return json({ error: "Missing q" }, 400);

    // Prefer a specific maps string up front for travel-like queries
    const travelish = /\b(holiday|holidays|getaway|getaways|trip|trips|weekend|resort|hotel|hostel|bnb|city\s*break|safari|tiger|wildlife|trek|hiking|beach|villa|things to do|attractions|national park)\b/i.test(prompt)
      || /\b(near me|in\s+[A-Za-z][\w\s'-]+)$/i.test(prompt);

    const preMapsQ = travelish ? buildSpecificMapsQuery(prompt) : prompt;

    // Ask the model to choose the tile
    let plan = await callOpenAI(preMapsQ);

    // Server-side hardening:
    if (plan?.type === "maps") {
      // ensure q is specific and non-generic
      const qCandidate = plan.q && !isGeneric(plan.q) ? plan.q : preMapsQ;
      plan.q = isGeneric(qCandidate) ? buildSpecificMapsQuery(prompt) : qCandidate;
      if (!plan.title) plan.title = `Search — ${prompt}`;
    }

    return json({ tile: plan });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
