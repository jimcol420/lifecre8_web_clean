// api/ai/route.js
// Classify a free-text query into a tile type and params.
// Safe fallback rules now; you can later swap in an LLM.
// Returns: { type, params, title }

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const { query } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Missing query" });
    }
    const q = query.trim();

    // URL → Web
    if (/^https?:\/\//i.test(q)) {
      try {
        const u = new URL(q);
        return res.json({ type: "web", params: { url: q }, title: u.hostname });
      } catch {}
    }

    // News
    if (/^news(\s|$)/i.test(q)) {
      const topic = q.replace(/^news/i, "").trim();
      return res.json({
        type: "news",
        params: { topic },
        title: topic ? `News — ${cap(topic)}` : "Daily Brief"
      });
    }

    // YouTube
    if (/^youtube\s+/i.test(q)) {
      const rest = q.replace(/^youtube/i, "").trim();
      return res.json({ type: "youtube", params: { q: rest }, title: rest ? `YouTube — ${cap(rest)}` : "YouTube" });
    }
    if (/(youtube\.com|youtu\.be)/i.test(q)) {
      return res.json({ type: "youtube", params: { q: q }, title: "YouTube" });
    }

    // Stocks (tickers or $tickers)
    if (/^stocks?\b/i.test(q) || /\$?[A-Z]{1,5}(?:[.\-][A-Z]{1,4})?/.test(q)) {
      const symbols = q.replace(/^stocks?\s*/i,"").replace(/\$/g,"").split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
      return res.json({ type: "stocks", params: { symbols }, title: "Markets" });
    }

    // Spotify embeds
    if (/spotify\.com/i.test(q)) {
      return res.json({ type: "spotify", params: { url: q }, title: "Spotify" });
    }

    // Fallback → Discover/Interest
    return res.json({ type: "discover", params: { topic: q }, title: cap(q) });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

function cap(s){ return (s||"").replace(/\s+/g," ").trim().replace(/\b\w/g,m=>m.toUpperCase()); }
