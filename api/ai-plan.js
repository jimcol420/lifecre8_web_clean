// Minimal single-tile planner used by Add Tile (no OpenAI needed).
// Returns ONE tile suggestion based on the user's query.

export default async function handler(req, res) {
  try {
    const q = (req.query?.q || req.body?.q || "").toString().trim();
    if (!q) return res.status(400).json({ error: "Missing q" });

    // ---- heuristics (order matters) ----
    const low = q.toLowerCase();

    // Travel intent -> Maps
    if (/(retreat|spa|resort|hotel|hostel|air\s*bnb|airbnb|villa|wellness|yoga|camp|lodg(e|ing)|stay|bnb|guesthouse|inn|aparthotel|boutique|residence|beach\s*resort|city\s*break)/i.test(low)
        || /\b(near me|in\s+[a-z][\w\s'-]+)$/i.test(low)) {
      return res.status(200).json({
        tile: { type: "maps", title: `Search — ${q}`, q }
      });
    }

    // YouTube intent
    if (/^youtube\s+/.test(low) || /(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w\-]+/.test(low)) {
      return res.status(200).json({
        tile: { type: "youtube", title: "YouTube", playlist: [] }
      });
    }

    // Stocks
    if (/\b(stocks?|markets?|ticker)\b/.test(low)) {
      return res.status(200).json({
        tile: { type: "stocks", title: "Markets", symbols: ["AAPL","MSFT","BTC-USD"] }
      });
    }

    // News explicit
    const mNews = low.match(/^news(?:\s+(.+))?$/i);
    if (mNews) {
      const topic = (mNews[1] || "").trim();
      if (!topic) {
        return res.status(200).json({ tile: { type: "rss", title: "Daily Brief (UK)", feeds: [
          "https://feeds.bbci.co.uk/news/rss.xml",
          "https://www.theguardian.com/uk-news/rss"
        ]}});
      }
      const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-GB&gl=GB&ceid=GB:en`;
      return res.status(200).json({ tile: { type: "rss", title: `Daily Brief — ${topic}`, feeds: [feedUrl] }});
    }

    // Recipes/products/shopping — web search tile
    if (/\b(recipe|recipes|buy|for sale|price|best|review|compare|ideas?)\b/.test(low)) {
      return res.status(200).json({
        tile: { type: "websearch", title: "Search …", q }
      });
    }

    // Default: web search tile
    return res.status(200).json({
      tile: { type: "websearch", title: "Search …", q }
    });
  } catch (err) {
    res.status(500).json({ error: "planner_failed", message: String(err) });
  }
}
