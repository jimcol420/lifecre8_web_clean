// Very light HTML text/image extractor used by RSS/image helpers.
// Keeps it simple to avoid TS/Node type issues.

export default async function handler(req, res) {
  try {
    const url = (req.query?.url || req.body?.url || "").toString().trim();
    if (!url) return res.status(400).json({ error: "Missing url" });

    const r = await fetch(url, { headers: { "user-agent": "LifeCre8Bot/1.0" }});
    if (!r.ok) return res.status(502).json({ error: "fetch_failed", status: r.status });

    const html = await r.text();
    const title = (html.match(/<title>([^<]+)<\/title>/i) || [,""])[1].trim();

    // quick image scrape
    const imgs = [];
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
      const src = m[1];
      if (!src) continue;
      if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(src)) imgs.push(new URL(src, url).toString());
      if (imgs.length >= 12) break;
    }

    res.status(200).json({ title, images: imgs });
  } catch (err) {
    res.status(500).json({ error: "extract_failed", message: String(err) });
  }
}
