// @ts-nocheck
// Simple, dependency-free planner that returns ONE best-fit tile.
// Request:  GET /api/ai-plan?q=<query>
// Response: { message: string, tile: { type: "...", ... } }

export default async function handler(req, res) {
  try {
    const q = (req.query?.q || req.body?.q || "").toString().trim();
    if (!q) {
      res.status(200).json({ message: "Tell me what you want and I’ll make a tile for it.", tile: null });
      return;
    }

    const lower = q.toLowerCase();

    // 1) Travel → maps
    const travelRe = /(retreat|spa|resort|hotel|hostel|air\s*bnb|airbnb|villa|wellness|yoga|camp|lodg(e|ing)|stay|bnb|guesthouse|inn|aparthotel|boutique|residence|near me|in\s+[a-z])/i;
    if (travelRe.test(lower)) {
      res.status(200).json({
        message: "Travel/search intent detected — added a Maps tile.",
        tile: { type:"maps", q, title:`Search — ${q}` }
      });
      return;
    }

    // 2) Recipes → rss (food blogs) or web search
    if (/(recipe|cook|bake|cake|dinner|lunch|breakfast)/i.test(lower)) {
      const feed = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " recipe")}&hl=en-GB&gl=GB&ceid=GB:en`;
      res.status(200).json({
        message: "Food/recipe intent — added a curated Daily Brief for recipes.",
        tile: { type:"rss", feeds:[feed], title:`Recipes — ${q}` }
      });
      return;
    }

    // 3) Shopping → web search
    if (/(buy|for sale|price|best|review|compare|deal)/i.test(lower)) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      res.status(200).json({
        message: "Shopping intent — added a search tile you can open/emb ed.",
        tile: { type:"web", url, title:`Search — ${q}` }
      });
      return;
    }

    // 4) YouTube request
    if (/^youtube /.test(lower) || /watch\?v=|youtu\.be\//.test(lower)) {
      const urlId = (q.match(/(?:watch\?v=|youtu\.be\/)([A-Za-z0-9_\-]+)/) || [])[1];
      const playlist = urlId ? [urlId] : ["M7lc1UVf-VE","5qap5aO4i9A","jfKfPfyJRdk"];
      res.status(200).json({
        message: "YouTube tile created.",
        tile: { type:"youtube", playlist }
      });
      return;
    }

    // 5) News explicit
    const mNews = q.match(/^news(?:\s+(.+))?$/i);
    if (mNews) {
      const topic = (mNews[1]||"").trim();
      const feeds = topic
        ? [`https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-GB&gl=GB&ceid=GB:en`]
        : [
            "https://feeds.bbci.co.uk/news/rss.xml",
            "https://www.theguardian.com/uk-news/rss"
          ];
      res.status(200).json({
        message: "Daily Brief added.",
        tile: { type:"rss", feeds, title: topic ? `Daily Brief — ${topic}` : "Daily Brief" }
      });
      return;
    }

    // 6) If it looks like an imagey topic → gallery (unsplash)
    if (/(wallpaper|inspiration|ideas|design|nature|landscape|architecture|art|cars?|animals?)/i.test(lower)) {
      const base = "https://source.unsplash.com/featured/?";
      const pics = Array.from({length:8}, (_,i)=> `${base}${encodeURIComponent(q)}&sig=${i}`);
      res.status(200).json({
        message: "Gallery tile created.",
        tile: { type:"gallery", images: pics, title:`Gallery — ${q}` }
      });
      return;
    }

    // 7) Default: intelligent web + a news feed if it reads like a topic
    const looksLikeTopic = /\s/.test(lower) && lower.length > 8;
    if (looksLikeTopic) {
      res.status(200).json({
        message: "Topic detected — curated Daily Brief added.",
        tile: { type:"rss", feeds:[`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`], title:`Daily Brief — ${q}` }
      });
      return;
    }

    // 8) Fallback strict web search
    res.status(200).json({
      message: "Search tile added.",
      tile: { type:"web", url:`https://www.google.com/search?q=${encodeURIComponent(q)}`, title:`Search — ${q}` }
    });
  } catch (e) {
    res.status(200).json({ message: "Planner error; adding a search tile.", tile: { type:"web", url:"https://www.google.com", title:"Search …" } });
  }
}
