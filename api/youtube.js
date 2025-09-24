// /api/youtube.js
// Simple, robust YouTube search proxy for the client.
// Uses env var YT_API_KEY (falls back to YT_API_KEY2 if present).

module.exports = async (req, res) => {
  try {
    const key = process.env.YT_API_KEY || process.env.YT_API_KEY2 || "";
    const q = (req.query.q || "news").toString().slice(0, 120);
    const max = Math.min(parseInt(req.query.max || "8", 10) || 8, 25);

    // Helpful note if the env var is missing (so you see it immediately in-browser)
    if (!key) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.status(200).json({ items: [], note: "No YT_API_KEY set" });
      return;
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", String(max));
    url.searchParams.set("q", q);
    url.searchParams.set("key", key);

    const yt = await fetch(url.toString(), { headers: { "Accept": "application/json" } });

    if (!yt.ok) {
      const text = await yt.text();
      console.error("YT API error:", yt.status, text); // shows in Vercel logs
      res.status(yt.status).json({ items: [], error: `YT API ${yt.status}`, body: text.slice(0, 500) });
      return;
    }

    const data = await yt.json();

    // Normalize to the bits we actually display
    const items = (data.items || []).map(item => {
      const id = item.id?.videoId || null;
      const s  = item.snippet || {};
      return {
        id,
        title: s.title || "",
        channel: s.channelTitle || "",
        thumb: s.thumbnails?.medium?.url || s.thumbnails?.default?.url || "",
        publishedAt: s.publishedAt || ""
      };
    }).filter(x => !!x.id);

    // Cache at the edge a little to keep things snappy, but still refresh soon.
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=300");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json({ items });
  } catch (err) {
    console.error("YT handler error:", err);
    res.status(500).json({ items: [], error: "Server error" });
  }
};
