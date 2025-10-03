/**
 * LifeCre8 — /api/ai-search
 * Returns a "tile plan" for a user query. If OPENAI_API_KEY is set,
 * uses OpenAI for smarter planning; otherwise falls back to a local plan.
 *
 * Response shape:
 * {
 *   "query": "pigs",
 *   "tiles": [
 *     { "type":"rss", "title":"Daily Brief — pigs",  "feeds":[ ... ] },
 *     { "type":"web", "title":"Wikipedia — pigs",    "url":"https://en.wikipedia.org/wiki/Pig" },
 *     { "type":"gallery", "title":"pigs — Gallery",  "images":[ ... ] },
 *     { "type":"web", "title":"YouTube — pigs",      "url":"https://www.youtube.com/results?search_query=pigs" }
 *   ]
 * }
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---- Utilities -------------------------------------------------------------

function ok(res, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).end(JSON.stringify(data));
}
function bad(res, msg, code = 400) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(code).end(JSON.stringify({ error: msg }));
}
function gnFeed(topic) {
  // Google News RSS for topic (UK/EN locale)
  return `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-GB&gl=GB&ceid=GB:en`;
}
function wikiUrl(topic) {
  // A decent first guess; front-end opens in preview/embed anyway
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(topic.replace(/\s+/g, '_'))}`;
}
function ytSearchUrl(topic) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(topic)}`;
}
function unsplashSet(topic, n = 6) {
  // Source.unsplash is fine for non-commercial demo visuals
  return Array.from({ length: n }, (_, i) =>
    `https://source.unsplash.com/600x600/?${encodeURIComponent(topic)}&sig=${i + 1}`
  );
}
function normalizeTopic(q) {
  return (q || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

// Simple signal detection for sports fixtures
function isFixturesQuery(q) {
  return /(football|soccer).*(fixture|fixtures|today|score|scores|match|matches)/i.test(q);
}
function fixturesPlan(q) {
  const url = "https://www.bbc.co.uk/sport/football/scores-fixtures";
  return {
    query: q,
    tiles: [
      {
        type: "web",
        title: "Football — Fixtures (Today)",
        url
      },
      {
        type: "rss",
        title: "Football Headlines",
        feeds: ["https://feeds.bbci.co.uk/sport/football/rss.xml"]
      }
    ]
  };
}

// ---- Local (no-OpenAI) planner -------------------------------------------
function localPlan(q) {
  const topic = normalizeTopic(q);
  if (!topic) {
    return { query: q, tiles: [] };
  }
  if (/^news$/i.test(topic)) {
    return {
      query: q,
      tiles: [
        { type: "rss", title: "Daily Brief (UK)", feeds: [
          "https://feeds.bbci.co.uk/news/rss.xml",
          "https://www.theguardian.com/uk-news/rss"
        ]}
      ]
    };
  }
  if (/^news\s+/.test(topic) || /latest/i.test(topic)) {
    const t = topic.replace(/^news\s+/i, "");
    return {
      query: q,
      tiles: [
        { type: "rss", title: `Daily Brief — ${t}`, feeds: [gnFeed(t)] }
      ]
    };
  }
  if (isFixturesQuery(topic)) {
    return fixturesPlan(topic);
  }
  // General topic: news + gallery + wiki + YouTube search
  return {
    query: q,
    tiles: [
      { type: "rss",     title: `Daily Brief — ${topic}`, feeds: [gnFeed(topic)] },
      { type: "gallery", title: `${topic} — Gallery`,     images: unsplashSet(topic, 6) },
      { type: "web",     title: `Wikipedia — ${topic}`,   url: wikiUrl(topic) },
      { type: "web",     title: `YouTube — ${topic}`,     url: ytSearchUrl(topic) }
    ]
  };
}

// ---- OpenAI-assisted planner ----------------------------------------------
async function aiPlan(q, fetchImpl = fetch) {
  const topic = normalizeTopic(q);
  if (!topic) return { query: q, tiles: [] };

  const system = [
    "You are a planner for a dashboard of tiles.",
    "Given a user query, respond with a STRICT JSON object matching this schema:",
    "{ \"tiles\": [",
    "  // Items in display order (earlier items appear top-left)",
    "  // Allowed types: rss | web | youtube | stocks | gallery",
    "  // rss    -> { type, title, feeds:[url,...] }",
    "  // web    -> { type, title, url }",
    "  // youtube-> { type, title, playlist:[videoId,...] } // if unknown, omit",
    "  // stocks -> { type, title, symbols:[...tickers] }",
    "  // gallery-> { type, title, images:[...urls] }",
    "]}",
    "",
    "Rules:",
    "- Prefer at least one RSS tile for topical queries; use Google News RSS when in doubt.",
    "- Prefer a gallery for general topics using generic image URLs (do NOT require API keys).",
    "- For YouTube, if you can't provide video IDs, omit the youtube tile.",
    "- For sports fixtures today, include a 'web' tile pointing to BBC fixtures page:",
    "  https://www.bbc.co.uk/sport/football/scores-fixtures",
    "- Keep between 2 and 5 tiles total.",
    "- DO NOT include commentary outside of valid JSON.",
  ].join("\n");

  const user = `Query: ${topic}`;

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user }
    ],
    temperature: 0.2,
    response_format: { type: "json_object" } // ensures valid JSON
  };

  const resp = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error(`OpenAI error: ${resp.status}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // As a fallback, extract first JSON-ish block
    const m = content.match(/\{[\s\S]*\}$/);
    if (m) parsed = JSON.parse(m[0]);
  }
  // Validate and sanitize
  const tiles = Array.isArray(parsed?.tiles) ? parsed.tiles.slice(0, 5) : [];
  const safe = tiles
    .map(t => {
      if (!t || typeof t !== "object") return null;
      const type = String(t.type || "").toLowerCase();
      if (!["rss","web","youtube","stocks","gallery"].includes(type)) return null;

      if (type === "rss") {
        const feeds = Array.isArray(t.feeds) ? t.feeds.filter(Boolean) : [];
        if (!feeds.length) return null;
        return { type, title: t.title || `Daily Brief — ${topic}`, feeds };
      }
      if (type === "web") {
        if (!t.url) return null;
        return { type, title: t.title || "Web", url: t.url };
      }
      if (type === "youtube") {
        const playlist = Array.isArray(t.playlist) ? t.playlist.filter(Boolean) : [];
        if (!playlist.length) return null; // skip if empty
        return { type, title: t.title || "YouTube", playlist };
      }
      if (type === "stocks") {
        const symbols = Array.isArray(t.symbols) ? t.symbols.filter(Boolean).slice(0,8) : [];
        if (!symbols.length) return null;
        return { type, title: t.title || "Markets", symbols };
      }
      if (type === "gallery") {
        const images = Array.isArray(t.images) ? t.images.filter(Boolean).slice(0,10) : [];
        if (!images.length) return null;
        return { type, title: t.title || `${topic} — Gallery`, images };
      }
      return null;
    })
    .filter(Boolean);

  // If OpenAI returns nothing usable, fall back locally
  if (!safe.length) return localPlan(topic);
  return { query: topic, tiles: safe };
}

// ---- Handler ---------------------------------------------------------------
module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return bad(res, "Missing required query parameter: q");

    // Sports fixtures quick-path (reliable regardless of AI)
    if (isFixturesQuery(q)) {
      return ok(res, fixturesPlan(q));
    }

    if (OPENAI_API_KEY) {
      try {
        const plan = await aiPlan(q);
        return ok(res, plan);
      } catch (err) {
        // Fall through to local plan if AI request fails
        console.error("[ai-search] OpenAI failed, using local plan:", err?.message || err);
      }
    }

    // Local fallback (always works)
    return ok(res, localPlan(q));
  } catch (err) {
    console.error("[ai-search] fatal:", err);
    return bad(res, "Internal error", 500);
  }
};
