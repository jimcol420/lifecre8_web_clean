/* ============================================================
   LifeCre8 — /api/extract  v1.0
   Purpose: Produce 5–8 high-quality links (title, url, desc)
            for a free-text query to enrich Web tiles.
   Input:  GET /api/extract?q=<string>
   Output: { items: [{title, url, desc}] }
   If OPENAI_API_KEY is missing, returns an empty list gracefully.
============================================================ */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) return res.status(400).json({ items: [] });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(200).json({ items: [] }); // graceful no-AI mode

    const sys = `
You are a fast web librarian. Given a user query, output 5–8 useful links
as JSON: [{"title":"...", "url":"https://...", "desc":"..."}].
Prefer authoritative, practical sources (docs, recipe sites, retailers for shopping intent, etc.).
Do not include news unless the query explicitly asks for news.
Return JSON ONLY.
`.trim();

    const user = `Query: "${q}"\nReturn 5–8 items JSON ONLY.`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ]
      })
    });

    if (!r.ok) {
      const txt = await r.text().catch(()=> '');
      return res.status(200).json({ items: [], note: 'ai_error', detail: txt.slice(0,300) });
    }

    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    let items = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed.slice(0,8);
    } catch {
      // try to salvage JSON array
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) { try { items = JSON.parse(m[0]).slice(0,8); } catch {} }
    }

    // sanitize
    items = (items || []).filter(it => it && it.title && it.url).map(it => ({
      title: String(it.title).slice(0,140),
      url: String(it.url),
      desc: (it.desc ? String(it.desc) : '').slice(0,220)
    }));

    return res.status(200).json({ items });
  } catch {
    return res.status(200).json({ items: [] });
  }
}
