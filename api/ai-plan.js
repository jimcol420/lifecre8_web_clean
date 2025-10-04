// Planner endpoint the Add-Tile flow calls to decide ONE tile to create.
// GET /api/ai-plan?q=your+query
// Responds: { tile: { type, ... } }  (single-tile only)

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

export default async function handler(req, res) {
  try {
    // Basic CORS (adjust as needed)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const q = (req.query.q || "").toString().trim();
    if (!q) return res.status(200).json({ tile: fallbackNews("Top stories") });

    // --- Intent heuristics (keep it simple & safe) ---

    // 1) Travel → Maps
    const TRAVEL_RE = /(retreat|spa|resort|hotel|hostel|air\s*bnb|airbnb|villa|wellness|yoga|camp|lodg(e|ing)|stay|bnb|guesthouse|inn|aparthotel|boutique|residence|beach\s*resort|city\s*break|holiday|getaway|staycation|weekend)/i;
    const GEO_HINT  = /\b(near me|in\s+[A-Za-z][\w\s'-]+)$/i;
    if (TRAVEL_RE.test(q) || GEO_HINT.test(q)) {
      return res.status(200).json({
        tile: { type: "maps", q, title: `Search — ${q}` }
      });
    }

    // 2) Cars for sale → Web tile to vertical
    if (/\bcars?\s+for\s+sale\b/i.test(q)) {
      const encoded = encodeURIComponent(q);
      // Try UK-focused verticals first; the client shows Preview w/ "Open" anyway
      const url = `https://www.autotrader.co.uk/car-search?postcode=&keywords=${encoded}`;
      return res.status(200).json({
        tile: { type: "web", url, title: "AutoTrader — search" }
      });
    }

    // 3) Recipes → Web tile to recipe vertical
    if (/recipe|recipes|bake|cook|how to make/i.test(q)) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(q + " recipe")}`;
      return res.status(200).json({
        tile: { type: "web", url, title: "Recipe search" }
      });
    }

    // 4) YouTube
    if (/^youtube\s+/i.test(q)) {
      // Let the client default playlist if none—still specify a starter list:
      return res.status(200).json({
        tile: { type: "youtube", playlist: ["M7lc1UVf-VE","5qap5aO4i9A","DWcJFNfaw9c","jfKfPfyJRdk"], title: "YouTube" }
      });
    }

    // 5) Stocks/Markets
    if (/stocks?|markets?|ftse|nasdaq|s&p|dow/i.test(q)) {
      return res.status(200).json({
        tile: { type: "stocks", symbols: ["AAPL","MSFT","BTC-USD"], title: "Markets" }
      });
    }

    // 6) Generic topic → one RSS Daily Brief using Google News
    return res.status(200).json({ tile: topicNews(q) });

  } catch (err) {
    console.error("ai-plan error:", err);
    // Fail-safe: fall back to a generic news tile
    return res.status(200).json({ tile: fallbackNews("Top stories") });
  }
}

// --- helpers ---
function topicNews(topic) {
  const feed = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-GB&gl=GB&ceid=GB:en`;
  return { type: "rss", title: `Daily Brief — ${topic}`, feeds: [feed] };
}
function fallbackNews(title) {
  const feed = "https://feeds.bbci.co.uk/news/rss.xml";
  return { type: "rss", title, feeds: [feed] };
}
