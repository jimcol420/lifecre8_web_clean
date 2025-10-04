// @ts-nocheck
// Minimal metadata extractor used by planner if you later want titles/images.
// GET /api/extract?url=...

export default async function handler(req, res) {
  try {
    const url = (req.query?.url || "").toString();
    if (!/^https?:\/\//i.test(url)) {
      res.status(400).json({ ok:false, error:"bad url" });
      return;
    }
    const r = await fetch(url, { headers: { "User-Agent": "LifeCre8/1.0" } });
    const html = await r.text();

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const ogTitle    = html.match(/property=['"]og:title['"][^>]*content=['"]([^'"]+)['"]/i);
    const ogImage    = html.match(/property=['"]og:image['"][^>]*content=['"]([^'"]+)['"]/i);

    res.status(200).json({
      ok: true,
      title: (ogTitle && ogTitle[1]) || (titleMatch && titleMatch[1]) || "",
      image: ogImage ? ogImage[1] : ""
    });
  } catch (e) {
    res.status(200).json({ ok:false, error:"extract failed" });
  }
}
