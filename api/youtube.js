// api/youtube.js
// LifeCre8 v1.10.0 — YouTube Data API proxy (IDs or Playlist → rich metadata)

export default async function handler(req, res) {
  try {
    const key = process.env.YT_API_KEY;
    if (!key) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ items: [], note: 'No YT_API_KEY set' });
    }

    const { ids = "", playlistId = "" } = req.query;
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');

    const pick = (obj, arr) => Object.fromEntries(arr.map(k => [k, obj[k]]));

    // Helper: fetch JSON with small retry
    const get = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.json();
    };

    // If playlistId provided, first expand to video IDs
    let idList = [];
    if (playlistId) {
      const base = 'https://www.googleapis.com/youtube/v3/playlistItems';
      let pageToken = "";
      do {
        const url = new URL(base);
        url.searchParams.set('part', 'snippet,contentDetails');
        url.searchParams.set('playlistId', playlistId);
        url.searchParams.set('maxResults', '50');
        url.searchParams.set('key', key);
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const data = await get(url.toString());
        (data.items || []).forEach(it => {
          const vid = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
          if (vid) idList.push(vid);
        });
        pageToken = data.nextPageToken || "";
      } while (pageToken);
    }

    // Or use explicit ids
    if (!idList.length && ids) {
      idList = ids.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Nothing to do
    if (!idList.length) {
      return res.status(200).json({ items: [] });
    }

    // Fetch metadata for IDs in chunks (max 50 per call)
    const all = [];
    const videoBase = 'https://www.googleapis.com/youtube/v3/videos';
    for (let i = 0; i < idList.length; i += 50) {
      const chunk = idList.slice(i, i + 50);
      const url = new URL(videoBase);
      url.searchParams.set('part', 'snippet,contentDetails');
      url.searchParams.set('id', chunk.join(','));
      url.searchParams.set('key', key);

      const data = await get(url.toString());
      (data.items || []).forEach(v => {
        const s = v.snippet || {};
        const thumbs = s.thumbnails || {};
        const pickBest =
          thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url ||
          thumbs.medium?.url || thumbs.default?.url || "";

        all.push({
          id: v.id,
          title: s.title || `YouTube video ${v.id}`,
          channel: s.channelTitle || "",
          publishedAt: s.publishedAt || null,
          thumb: pickBest
        });
      });
    }

    // Keep same order as requested
    const order = new Map(idList.map((id, idx) => [id, idx]));
    all.sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));

    return res.status(200).json({ items: all });
  } catch (err) {
    console.error('YT API error:', err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ items: [], error: String(err) });
  }
}
