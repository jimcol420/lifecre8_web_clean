// api/ai-tile.js
// Purpose: Given a free-form query, return ONE tile plan the client can render.
// Supports: maps (travel intent), rss, web, youtube, gallery.
// Uses demonym → country mapping & normalizes travel queries, mirroring client logic.

export default async function handler(req, res) {
  try {
    const { q = "" } = req.query;
    const query = String(q || "").trim();
    if (!query) return res.status(400).json({ error: "missing q" });

    // 1) Travel intent (server-side mirror)
    const DEMONYMS = {
      "british":"United Kingdom","english":"England","scottish":"Scotland","welsh":"Wales","irish":"Ireland",
      "french":"France","spanish":"Spain","italian":"Italy","german":"Germany","portuguese":"Portugal",
      "thai":"Thailand","greek":"Greece","turkish":"Turkey","dutch":"Netherlands","swiss":"Switzerland",
      "austrian":"Austria","norwegian":"Norway","swedish":"Sweden","danish":"Denmark","finnish":"Finland",
      "icelandic":"Iceland","moroccan":"Morocco","egyptian":"Egypt","japanese":"Japan","korean":"Korea",
      "vietnamese":"Vietnam","indonesian":"Indonesia","malaysian":"Malaysia","australian":"Australia",
      "new zealand":"New Zealand","polish":"Poland","czech":"Czechia","hungarian":"Hungary","croatian":"Croatia",
      "canadian":"Canada","american":"United States","chilean":"Chile","argentinian":"Argentina","brazilian":"Brazil"
    };
    function demonymToCountry(text){
      const l = text.toLowerCase();
      const keys = Object.keys(DEMONYMS).sort((a,b)=>b.length-a.length);
      for (const k of keys) if (l.includes(k)) return DEMONYMS[k];
      return null;
    }
    function normalizeTravelQuery(val){
      const raw = (val || "").trim();
      if (!raw) return raw;
      if (/\bnear me\b/i.test(raw)) return raw;
      if (/\b(in|near|around)\s+[A-Za-z][\w\s'-]+$/i.test(raw)) return raw;
      if (/\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland)\b/i.test(raw) && !/united kingdom/i.test(raw)) {
        return `${raw} United Kingdom`;
      }
      const c = demonymToCountry(raw);
      if (c && !new RegExp(c, "i").test(raw)) return `${raw} ${c}`;
      if (/\b(holiday|holidays|break|breaks|trip|trips|ideas|getaway|getaways|staycation|weekend)\b/i.test(raw)) {
        return `${raw} United Kingdom`;
      }
      return raw;
    }

    const TRAVEL_RE = /(retreat|spa|resort|hotel|hostel|air\s*bnb|airbnb|villa|wellness|yoga|camp|lodg(e|ing)|stay|bnb|guesthouse|inn|aparthotel|boutique|residence|beach\s*resort|city\s*break|holiday|getaway|staycation|weekend|canal\s*boat|river\s*cruise|self\s*catering|villas?)/i;
    const GEO_HINT  = /\b(near me|in\s+[A-Za-z][\w\s'-]+)$/i;

    if (TRAVEL_RE.test(query) || GEO_HINT.test(query) || demonymToCountry(query)) {
      const qn = normalizeTravelQuery(query);
      return res.status(200).json({
        type: "maps",
        title: `Search — ${query}`,
        q: qn
      });
    }

    // 2) Heuristics before LLM: YouTube links
    const yt = query.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_\-]+)/i);
    if (yt) {
      const id = yt[1];
      return res.status(200).json({
        type: "youtube",
        title: "YouTube",
        playlist: [id]
      });
    }

    // 3) URL → Web
    if (/^https?:\/\//i.test(query)) {
      return res.status(200).json({
        type: "web",
        title: "Web",
        url: query
      });
    }

    // 4) Ask OpenAI to design ONE tile plan
    const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
    if (!key) {
      // graceful fallback → RSS for topic
      return res.status(200).json({
        type: "rss",
        title: `Daily Brief — ${query}`,
        feeds: [`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-GB&gl=GB&ceid=GB:en`]
      });
    }

    // Small, deterministic prompt to keep responses consistent
    const system = [
      "You are a tile planner for a dashboard.",
      "Given a user query, output exactly ONE tile plan as strict JSON.",
      "Types allowed: maps(web search phrase), web(url), rss([feedUrls]), youtube([videoIds]), gallery([imageUrls]).",
      "Prefer maps for travel/lodging/places. Prefer rss for topical newsy themes.",
      "Never output markdown. Only raw JSON."
    ].join(" ");

    const user = JSON.stringify({
      query,
      examples: [
        { q: "thai beachfront holiday villas", plan: { type:"maps", q:"thai beachfront holiday villas Thailand" } },
        { q: "chocolate cake recipes", plan: { type:"web", url:"https://www.seriouseats.com/chocolate-cake-recipes" } },
        { q: "football fixtures today", plan: { type:"rss", feeds:["https://feeds.bbci.co.uk/sport/football/rss.xml"] } }
      ]
    });

    // Use OpenAI responses API (compatible fetch)
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [{ role:"system", content:system }, { role:"user", content:user }],
        max_output_tokens: 400,
        temperature: 0.2
      })
    });

    if (!resp.ok) {
      // fallback to topic RSS
      return res.status(200).json({
        type: "rss",
        title: `Daily Brief — ${query}`,
        feeds: [`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-GB&gl=GB&ceid=GB:en`]
      });
    }

    const data = await resp.json();
    // Attempt to parse JSON from output_text
    const raw = data?.output_text || "";
    let plan = null;
    try {
      plan = JSON.parse(raw);
    } catch {
      // loose regex for JSON object
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { plan = JSON.parse(m[0]); } catch {} }
    }

    if (!plan || typeof plan !== "object") {
      return res.status(200).json({
        type: "rss",
        title: `Daily Brief — ${query}`,
        feeds: [`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-GB&gl=GB&ceid=GB:en`]
      });
    }

    // Normalize maps q with demonyms if present
    if (plan.type === "maps" && plan.q) {
      plan.q = normalizeTravelQuery(plan.q);
    } else if (plan.type === "maps" && !plan.q) {
      plan.q = normalizeTravelQuery(query);
    }

    return res.status(200).json(plan);
  } catch (err) {
    // Last-resort fallback → topic RSS
    const q = String(req.query?.q || "").trim() || "news";
    return res.status(200).json({
      type: "rss",
      title: `Daily Brief — ${q}`,
      feeds: [`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`]
    });
  }
}
