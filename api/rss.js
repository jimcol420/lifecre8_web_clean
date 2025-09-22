// api/rss.js — v1.10.2
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const urlParam = (req.query.url || '').toString();
    // Default to BBC Top Stories if none provided
    const feedUrl = urlParam || 'https://feeds.bbci.co.uk/news/rss.xml';

    const r = await fetch(feedUrl, { headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' }});
    if (!r.ok) throw new Error(`RSS fetch failed: ${r.status}`);
    const xml = await r.text();

    // very lightweight extraction
    const items = [];
    const itemRegex = /<item[\s\S]*?<\/item>/gi;
    const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i;
    const linkRegex  = /<link>([\s\S]*?)<\/link>/i;

    let m;
    while ((m = itemRegex.exec(xml)) && items.length < 8) {
      const itemXml = m[0];
      const t = itemXml.match(titleRegex);
      const l = itemXml.match(linkRegex);
      const title = (t?.[1] || t?.[2] || '').trim();
      const link  = (l?.[1] || '').trim();
      if (title && link) items.push({ title, link });
    }

    res.status(200).json({ ok: true, feed: feedUrl, items });
  } catch (err) {
    console.error('rss error:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
