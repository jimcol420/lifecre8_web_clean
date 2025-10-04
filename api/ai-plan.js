const TRAVEL_RE = /(retreat|spa|resort|hotel|hostel|air\s*bnb|airbnb|villa|wellness|yoga|camp|lodg(e|ing)|stay|bnb|guesthouse|inn|aparthotel|boutique|residence|beach\s*resort|city\s*break|holiday|getaway|staycation|weekend)/i;

function normalizeTravelQuery(q) {
  if (!q) return q;
  if (/\bnear me\b/i.test(q)) return q;
  const ukWords = /\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland)\b/i;
  const hasPlaceHint = /\b(in|near|around)\s+[A-Za-z][\w\s'-]+$/i.test(q);
  const generic = /\b(holiday|holidays|break|breaks|trip|trips|ideas|getaway|getaways|staycation|weekend)\b/i.test(q);
  if (ukWords.test(q)) return /united kingdom/i.test(q) ? q : `${q} United Kingdom`;
  if (!hasPlaceHint && generic) return `${q} United Kingdom`;
  return q;
}

export default async function handler(req, res) {
  try {
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const q = (searchParams.get("q") || "").trim();

    if (!q) return res.status(400).json({ error: "missing q" });

    // 1) Travel → maps
    if (TRAVEL_RE.test(q) || /\b(near me|in\s+[A-Za-z][\w\s'-]+)$/i.test(q)) {
      const nq = normalizeTravelQuery(q);
      return res.status(200).json({
        tile: { type: "maps", q: nq, title: `Search — ${nq}` }
      });
    }

    // 2) URL → web
    if (/^https?:\/\//i.test(q)) {
      return res.status(200).json({
        tile: { type: "web", url: q, title: "Web" }
      });
    }

    // 3) Default → RSS (Google News)
    const feed = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;
    return res.status(200).json({
      tile: { type: "rss", feeds: [feed], title: `Daily Brief — ${q}` }
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
