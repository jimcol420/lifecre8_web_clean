// api/preview.js
export default async function handler(req, res) {
  try {
    const url = (req.query.url || "").trim();
    if (!url) return res.status(400).json({ error: "Missing url" });

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6500);

    const r = await fetch(url, {
      headers: {
        // Pretend to be a browser – many sites gate on UA
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    clearTimeout(t);

    if (!r.ok) {
      return res.status(200).json({ image: null, favicon: faviconFor(url) });
    }

    const html = await r.text();
    const image =
      findMeta(html, 'property="og:image"') ||
      findMeta(html, 'name="og:image"') ||
      findMeta(html, 'name="twitter:image"') ||
      null;

    // Absolute-ize relative images
    const absImage = image ? new URL(image, url).toString() : null;

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({
      image: absImage,
      favicon: faviconFor(url),
    });
  } catch (e) {
    return res.status(200).json({ image: null, favicon: null });
  }
}

function findMeta(html, attr) {
  // very small & safe-ish extraction for OG/Twitter image
  const rx = new RegExp(
    `<meta[^>]+${attr}[^>]+content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(rx);
  return m ? m[1] : null;
}

function faviconFor(u) {
  try {
    const host = new URL(u).hostname;
    return `https://www.google.com/s2/favicons?sz=64&domain=${host}`;
  } catch {
    return null;
  }
}
