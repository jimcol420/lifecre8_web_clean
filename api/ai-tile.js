// api/ai-tile.js
/**
 * Multi-result AI tile endpoint
 * - Always returns several high-quality link targets (no iframes by default)
 * - Adds travel helpers (Maps / Booking / Tripadvisor) when query looks travel-y
 * - Never fabricates sources; uses trusted query URLs
 *
 * Query:  /api/ai-tile?q=<string>
 * Optional: &region=GB (affects Google/YouTube params a bit)
 *
 * Response shape:
 *  {
 *    title: string,
 *    items: Array<{
 *      kind: 'article'|'video'|'map'|'search'|'site',
 *      title: string,
 *      url: string,
 *      snippet?: string
 *    }>
 *  }
 */

export default async function handler(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    const region = (req.query.region || "GB").toUpperCase();

    if (!q) {
      return res.status(400).json({ error: "Missing q" });
    }

    // Helpers
    const enc = encodeURIComponent;
    const gg = (s) =>
      `https://www.google.com/search?q=${enc(s)}&hl=en-${region}&gl=${region}`;
    const gnews = (s) =>
      `https://news.google.com/search?q=${enc(s)}&hl=en-${region}&gl=${region}&ceid=${region}:en`;
    const yt = (s) =>
      `https://www.youtube.com/results?search_query=${enc(s)}`;
    const maps = (s) => `https://www.google.com/maps/search/${enc(s)}`;
    const wiki = (s) =>
      `https://en.wikipedia.org/w/index.php?search=${enc(s)}`;

    const looksTravel = /(hotel|resort|hostel|bnb|air\s*bnb|airbnb|spa|retreat|villa|lodg(e|ing)|guesthouse|inn|aparthotel|beach|city\s*break|holiday|holidays|staycation|getaway|wellness|yoga|near me|in\s+[A-Za-z][\w\s'-]+)$/i.test(
      q
    );

    // Always offer a few “best bets” links (no fabrications)
    const items = [
      {
        kind: "search",
        title: "Top results on Google",
        url: gg(q),
        snippet: "Open a full web search for broader coverage.",
      },
      {
        kind: "article",
        title: "News coverage (Google News)",
        url: gnews(q),
        snippet: "Recent and reputable news sources about this topic.",
      },
      {
        kind: "video",
        title: "Watch on YouTube",
        url: yt(q),
        snippet: "Tutorials, walkthroughs, explainers, and reviews.",
      },
      {
        kind: "site",
        title: "Wikipedia overview",
        url: wiki(q),
        snippet: "Neutral overview and key facts, when available.",
      },
    ];

    if (looksTravel) {
      const normQ = normalizeTravelQuery(q);
      items.unshift({
        kind: "map",
        title: `View on Google Maps — ${normQ}`,
        url: maps(normQ),
        snippet: "Explore places, ratings, and routes on the map.",
      });
      items.push(
        {
          kind: "site",
          title: "Booking.com",
          url: `https://www.booking.com/searchresults.html?ss=${enc(normQ)}`,
          snippet: "Hotels and stays (filters, prices, availability).",
        },
        {
          kind: "site",
          title: "Tripadvisor",
          url: `https://www.tripadvisor.com/Search?q=${enc(normQ)}`,
          snippet: "Reviews, rankings, attractions, food & activities.",
        }
      );
    }

    return res.status(200).json({
      title: `Results — ${q}`,
      items,
    });
  } catch (err) {
    console.error("[ai-tile] error:", err);
    return res.status(500).json({ error: "ai-tile failed" });
  }
}

// Shared with client (keep in sync with main.js)
function normalizeTravelQuery(val) {
  const raw = (val || "").trim();
  if (!raw) return raw;
  if (/\bnear me\b/i.test(raw)) return raw;

  const ukWords =
    /\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland)\b/i;
  const hasPlaceHint = /\b(in|near|around)\s+[A-Za-z][\w\s'-]+$/i.test(raw);
  const isVeryGeneric =
    /\b(holiday|holidays|break|breaks|trip|trips|ideas|getaway|getaways|staycation|weekend)\b/i.test(
      raw
    );

  if (ukWords.test(raw)) {
    return /united kingdom/i.test(raw) ? raw : `${raw} United Kingdom`;
  }
  if (!hasPlaceHint && isVeryGeneric) {
    return `${raw} United Kingdom`;
  }
  return raw;
}
