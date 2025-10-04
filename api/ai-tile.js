// /api/ai-tile.js
// Returns ONE best-fit tile for a free-form query.
// Env: OPENAI_API_KEY must be set in Vercel -> Settings -> Environment Variables.

const MODEL = 'gpt-4o-mini';

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = (url.searchParams.get('q') || '').trim();

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || process.env.OPEN_AI_KEY || process.env.OPEN_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        message: "AI-tile is in demo mode (no API key on the server).",
        diag: { hasKey: false }
      });
    }
    if (!q) return res.status(400).json({ error: "Missing q" });

    // System prompt: make ONE tile only, using our allowed schema.
    const system = `
You are the "tile planner" for a dashboard. Given a user query, output a SINGLE tile
object that best answers the request. Use ONLY this JSON shape:

{
  "type": "maps" | "web" | "rss" | "youtube" | "gallery" | "stocks" | "spotify",
  "title": string,
  // extras by type:
  "q": string,                       // maps
  "url": string,                     // web|spotify
  "feeds": [string],                 // rss
  "playlist": [string],              // youtube (list of video IDs)
  "images": [string],                // gallery (absolute URLs)
  "symbols": [string]                // stocks (tickers or crypto symbols)
}

Decision rules:
- If the query looks like travel/place discovery (retreat, hotel, spa, resort, "in <city>", "near me", etc.)
  prefer {"type":"maps","q":<cleaned search>}.
- If the query is "news <topic>" or trending/current-events -> {"type":"rss","feeds":[Google News RSS for that topic]}.
- If explicitly a URL -> {"type":"web","url":<same>}.
- If a YouTube share URL -> youtube tile with that video ID in "playlist".
- If "stocks", "BTC", tickers, "markets" -> stocks tile.
- If "photos", "wallpapers", "art" -> gallery tile with 4–8 image URLs.
- Else: prefer a good web page (web tile). If unsure, fall back to RSS for the topic.

Never return multiple tiles. Always return valid JSON only.
    `.trim();

    const user = `Query: ${q}\nReturn only the JSON object, no prose.`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(500).json({ error: "openai_error", details: txt });
    }

    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '{}';

    // Some models wrap in ```json fences — strip if present.
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```$/i, '');
    let tile;
    try { tile = JSON.parse(jsonStr); }
    catch { return res.status(200).json({ message: "Could not parse model JSON.", raw }); }

    // Sanity: coerce type + allow-list fields only
    const allow = new Set(["maps","web","rss","youtube","gallery","stocks","spotify"]);
    if (!allow.has(tile.type)) tile.type = "web";
    const out = { type: tile.type, title: tile.title || q };
    if (tile.type === "maps") out.q = tile.q || q;
    if (tile.type === "web") out.url = tile.url || `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    if (tile.type === "spotify") out.url = tile.url || "https://open.spotify.com/";
    if (tile.type === "rss") out.feeds = Array.isArray(tile.feeds) && tile.feeds.length ? tile.feeds
      : [`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`];
    if (tile.type === "youtube") out.playlist = Array.isArray(tile.playlist) && tile.playlist.length ? tile.playlist : [];
    if (tile.type === "gallery") out.images = Array.isArray(tile.images) ? tile.images.slice(0, 8) : [];
    if (tile.type === "stocks") out.symbols = Array.isArray(tile.symbols) && tile.symbols.length ? tile.symbols : ["AAPL","MSFT","BTC-USD"];

    return res.status(200).json({ tile: out });
  } catch (err) {
    return res.status(500).json({ error: "server_error", details: String(err) });
  }
};
