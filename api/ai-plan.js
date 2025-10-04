/* ============================================================
   LifeCre8 — api/ai-plan.js  v1.9.8
   Returns ONE best-fit tile for query q.
   Response shape: { message, tiles: [{ type, ...meta }] }
============================================================ */
export default async function handler(req, res) {
  try {
    const q = ((req.query && req.query.q) || (req.body && req.body.q) || "")
      .toString()
      .trim();
    if (!q) return res.status(200).json({ message: "Empty query", tiles: [] });

    const lower = q.toLowerCase();

    // 1) TRAVEL (dominates)
    const travelRe = /(holiday|holidays|city\s*break|weekend\s*(away)?|retreat|spa|resort|hotel|hostel|air\s*bnb|airbnb|villa|things to do|places to visit|near me|in\s+[a-z])/i;
    if (travelRe.test(lower)) {
      return res.status(200).json({
        message: "Travel intent — Maps tile",
        tiles: [{ type: "maps", q, title: `Search — ${q}` }],
      });
    }

    // 2) RECIPES
    if (/(recipe|cook|bake|cake|dessert|dinner|lunch|breakfast)/i.test(lower)) {
      const feed = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " recipe")}&hl=en-GB&gl=GB&ceid=GB:en`;
      return res.status(200).json({
        message: "Recipe intent — Daily Brief",
        tiles: [{ type: "rss", feeds: [feed], title: `Recipes — ${q}` }],
      });
    }

    // 3) SHOPPING
    if (/(buy|for sale|price|best|review|compare|deal)s?/i.test(lower)) {
      return res.status(200).json({
        message: "Shopping intent — Search tile",
        tiles: [{
          type: "web",
          url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
          title: `Search — ${q}`,
        }],
      });
    }

    // 4) YOUTUBE
    if (/^youtube /.test(lower) || /watch\?v=|youtu\.be\//.test(lower)) {
      const idMatch = q.match(/(?:watch\?v=|youtu\.be\/)([A-Za-z0-9_\-]+)/);
      const vid = idMatch ? idMatch[1] : null;
      const playlist = vid ? [vid] : ["M7lc1UVf-VE", "5qap5aO4i9A", "jfKfPfyJRdk"];
      return res.status(200).json({
        message: "YouTube tile",
        tiles: [{ type: "youtube", playlist, title: "YouTube" }],
      });
    }

    // 5) Explicit "news ..."
    const mNews = q.match(/^news(?:\s+(.+))?$/i);
    if (mNews) {
      const topic = (mNews[1] || "").trim();
      const feeds = topic
        ? [`https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-GB&gl=GB&ceid=GB:en`]
        : ["https://feeds.bbci.co.uk/news/rss.xml", "https://www.theguardian.com/uk-news/rss"];
      return res.status(200).json({
        message: "Daily Brief",
        tiles: [{ type: "rss", feeds, title: topic ? `Daily Brief — ${topic}` : "Daily Brief" }],
      });
    }

    // 6) Visual-only intents (gallery)
    if (/(wallpaper|aesthetic|moodboard|logo\s+ideas?|poster\s+ideas?|reference\s+sheet|concept\s+art)/i.test(lower)) {
      const base = "https://source.unsplash.com/600x400/?";
      const images = Array.from({ length: 8 }, (_, i) => `${base}${encodeURIComponent(q)}&sig=${i}`);
      return res.status(200).json({
        message: "Gallery tile",
        tiles: [{ type: "gallery", images, title: `Gallery — ${q}` }],
      });
    }

    // 7) General topic → Daily Brief
    if (/\s/.test(lower) && lower.length > 8) {
      return res.status(200).json({
        message: "Topic — Daily Brief",
        tiles: [{
          type: "rss",
          feeds: [`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`],
          title: `Daily Brief — ${q}`,
        }],
      });
    }

    // 8) Fallback: Web search
    return res.status(200).json({
      message: "Fallback — Search tile",
      tiles: [{
        type: "web",
        url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        title: `Search — ${q}`,
      }],
    });
  } catch (e) {
    return res.status(200).json({
      message: "Planner error — search tile",
      tiles: [{ type: "web", url: "https://www.google.com", title: "Search …" }],
    });
  }
}
