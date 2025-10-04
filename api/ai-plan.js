// api/ai-plan.js
// LifeCre8 — AI Planner (single-tile)
// Heuristic, zero-dependency planner that returns ONE best-fit tile for a query.
// NOTE: Keep this in sync with client addTileFlow() keywords.

export default function handler(req, res) {
  try {
    const q = (req.query.q || req.body?.q || "").toString().trim();
    if (!q) return res.status(200).json({ tiles: [], message: "Empty query." });

    const low = q.toLowerCase();

    // Helpers
    const isUrl = /^https?:\/\//i.test(q);
    const match = (re) => re.test(low);
    const tile = (t) => res.status(200).json({ tiles: [t], message: "ok" });

    // 1) Direct URL → Web
    if (isUrl) {
      return tile({
        type: "web",
        title: new URL(q).hostname || "Web",
        url: q
      });
    }

    // 2) Travel intent → Maps
    const TRAVEL_RE = /(retreat|spa|resort|hotel|hostel|air\s*bnb|airbnb|villa|wellness|yoga|camp|lodg(e|ing)|stay|bnb|guesthouse|inn|aparthotel|boutique|residence|beach\s*resort|city\s*break|holiday|holidays)/i;
    const GEO_HINT  = /\b(near me|in\s+[a-z][\w\s'-]+)$/i;
    if (match(TRAVEL_RE) || GEO_HINT.test(low)) {
      return tile({
        type: "maps",
        title: `Search — ${q}`,
        q
      });
    }

    // 3) News quick command
    const mNews = low.match(/^news(?:\s+(.+))?$/i);
    if (mNews) {
      const topic = (mNews[1] || "").trim();
      const feeds = topic
        ? [`https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-GB&gl=GB&ceid=GB:en`]
        : [
            "https://feeds.bbci.co.uk/news/rss.xml",
            "https://www.theguardian.com/uk-news/rss",
          ];
      return tile({
        type: "rss",
        title: topic ? `Daily Brief — ${topic}` : "Daily Brief (UK)",
        feeds
      });
    }

    // 4) YouTube links / command
    const yt = q.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_\-]+)/i);
    if (yt) {
      const id = yt[1];
      return tile({ type: "youtube", title: "YouTube", playlist: [id] });
    }
    if (low.startsWith("youtube ")) {
      return tile({ type: "youtube", title: "YouTube", playlist: ["M7lc1UVf-VE"] });
    }

    // 5) Recipes / how-to → Web search (not news)
    if (match(/\b(recipe|recipes|how to|guide|tutorial|ingredients)\b/i)) {
      return tile({
        type: "web",
        title: "Search …",
        url: `https://www.google.com/search?q=${encodeURIComponent(q)}`
      });
    }

    // 6) Shopping / for-sale intent → Web search
    if (match(/\b(buy|for sale|price|prices|best|cheap|deal|deals)\b/i)) {
      return tile({
        type: "web",
        title: "Search …",
        url: `https://www.google.com/search?q=${encodeURIComponent(q)}`
      });
    }

    // 7) Images / wallpapers → Gallery (Unsplash source URLs; no key needed)
    if (match(/\b(images?|photos?|pictures?|wallpaper|backgrounds?)\b/i)) {
      const qSlug = encodeURIComponent(q.replace(/\b(images?|photos?|pictures?)\b/gi, "").trim() || q);
      const urls = Array.from({ length: 8 }).map((_, i) =>
        `https://source.unsplash.com/600x400/?${qSlug}&sig=${i+1}`
      );
      return tile({ type: "gallery", title: `Gallery — ${q}`, images: urls });
    }

    // 8) Stocks / markets
    if (match(/\b(stocks?|markets?)\b/)) {
      return tile({ type: "stocks", title: "Markets", symbols: ["AAPL","MSFT","BTC-USD"] });
    }

    // 9) Default fallback: news about the topic (single RSS)
    return tile({
      type: "rss",
      title: `Daily Brief — ${q}`,
      feeds: [`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`]
    });
  } catch (e) {
    return res.status(200).json({ tiles: [], message: "planner error" });
  }
}
