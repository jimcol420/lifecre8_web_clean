/* ============================================================
   LifeCre8 — /api/ai-plan  v1.0
   Purpose: Turn any free-text query into ONE tile plan.
   Input:  GET /api/ai-plan?q=<string>
   Output: { tile: { type, title?, meta?, content? } }
   Notes:
   - Never returns multiple tiles.
   - Falls back to a safe WEB tile if the model is unsure.
   - Requires process.env.OPENAI_API_KEY
============================================================ */
import type { VercelRequest, VercelResponse } from '@vercel/node';

type TileType = 'web' | 'maps' | 'rss' | 'youtube' | 'stocks' | 'gallery' | 'spotify';
type TilePlan = {
  type: TileType;
  title?: string;
  // Minimal metadata per tile type; client will render from this
  url?: string;            // web
  q?: string;              // maps
  feeds?: string[];        // rss
  playlist?: string[];     // youtube (video IDs)
  symbols?: string[];      // stocks
  images?: string[];       // gallery
  spotifyUrl?: string;     // spotify
};

function safeDefault(q: string): TilePlan {
  // Conservative fallback is a Web search tile
  return {
    type: 'web',
    title: `Search — ${q}`,
    url: `https://www.google.com/search?q=${encodeURIComponent(q)}`
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'Missing q' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // If no key, just degrade gracefully to a deterministic plan
      return res.status(200).json({ tile: safeDefault(q) });
    }

    // Prompt: steer the model to ONE tile + strict JSON
    const sys = `
You are a planner that maps a user's query to EXACTLY ONE dashboard tile.
Never return an array of tiles. Choose the single best tile for the query.

Allowed tile types and fields:
- "web": { type, title?, url }
- "maps": { type, title?, q }                        // a Maps search string
- "rss": { type, title?, feeds[] }                   // list of RSS URLs
- "youtube": { type, title?, playlist[] }            // array of YouTube video IDs (not URLs)
- "stocks": { type, title?, symbols[] }              // e.g. ["AAPL","MSFT"]
- "gallery": { type, title?, images[] }              // image URLs
- "spotify": { type, title?, spotifyUrl }            // full open.spotify.com URL

Guidance:
- Shopping/product intent ("buy", "for sale", named gadgets): use "web" with a Google query or trusted retailer page.
- Travel/hotels/retreats/near me/in <city>: use "maps" with a concise search string.
- Recipes/tutorials/how-to: pick "web" with a trusted page (bbcgoodfood.com, serious eats, docs, MDN, etc.). Avoid RSS.
- Broad news topics ("news", "news <topic>"): use "rss" with Google News RSS or BBC/Reuters.
- Music queries with Spotify words/URLs: "spotify".
- Video topics with YouTube URLs/words: "youtube" with video IDs (strip URLs to IDs).
- Tickers/markets ("nvidia vs amd stock"): "stocks" with symbols.
- Visual inspiration ("modern cabin interior"): "gallery" with a few unsplash URLs.

If unsure, choose "web".

Return JSON ONLY:
{ "type": "...", "title": "...", ... }
`.trim();

    const user = `Query: "${q}"\nReturn ONE tile plan JSON per the schema.`;

    // Use fetch to OpenAI responses endpoint (works on Edge or Node)
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // small, fast, cheap; adjust if you prefer
        temperature: 0.2,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ]
      })
    });

    if (!r.ok) {
      const text = await r.text().catch(()=>'');
      // Soft fail to a safe plan
      return res.status(200).json({ tile: safeDefault(q), note: 'ai_error', detail: text.slice(0, 300) });
    }

    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    let plan: TilePlan | null = null;

    try {
      plan = JSON.parse(raw);
    } catch {
      // Try to salvage JSON chunk if the model wrapped it in text
      const m = raw.match(/\{[\s\S]*\}$/);
      if (m) {
        try { plan = JSON.parse(m[0]); } catch {}
      }
    }

    // Validate & sanitize to ensure ONE tile
    if (!plan || !plan.type) {
      return res.status(200).json({ tile: safeDefault(q), note: 'ai_parse_fallback' });
    }

    // Clamp to allowed types
    const allowed: TileType[] = ['web','maps','rss','youtube','stocks','gallery','spotify'];
    if (!allowed.includes(plan.type)) {
      return res.status(200).json({ tile: safeDefault(q), note: 'ai_type_fallback' });
    }

    // Minimal field checks
    if (plan.type === 'web' && !plan.url) {
      plan.url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    }
    if (plan.type === 'maps' && !plan.q) plan.q = q;
    if (plan.type === 'rss' && (!plan.feeds || !plan.feeds.length)) {
      plan.feeds = [`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`];
    }
    if (plan.type === 'youtube' && (!plan.playlist || !plan.playlist.length)) {
      // strip an ID if a URL was given in the query
      const m = q.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_\-]+)/i);
      if (m) plan.playlist = [m[1]];
    }
    if (plan.type === 'stocks' && (!plan.symbols || !plan.symbols.length)) {
      plan.symbols = ['AAPL','MSFT'];
    }
    if (plan.type === 'gallery' && (!plan.images || !plan.images.length)) {
      const base = (n:number)=>`https://source.unsplash.com/600x600/?${encodeURIComponent(q)}&sig=${n}`;
      plan.images = [base(1),base(2),base(3),base(4)];
    }
    if (plan.type === 'spotify' && !plan.spotifyUrl) {
      plan.type = 'web';
      plan.url = `https://open.spotify.com/search/${encodeURIComponent(q)}`;
    }

    // Title defaults
    if (!plan.title) {
      const mapTitle: Record<TileType,string> = {
        web: 'Web',
        maps: 'Map',
        rss: 'Daily Brief',
        youtube: 'YouTube',
        stocks: 'Markets',
        gallery: 'Gallery',
        spotify: 'Spotify'
      };
      plan.title = `${mapTitle[plan.type]} — ${q}`;
    }

    return res.status(200).json({ tile: plan });
  } catch (err:any) {
    return res.status(200).json({ tile: safeDefault(req.query.q as string || 'search'), note: 'server_error' });
  }
}
