/* =========================================================
   LifeCre8 — rss.js  v1.12.0
   - Fetches /api/rss
   - Extracts thumbnails via common fields in items:
     image | media:thumbnail | enclosure | first <img ...> in description
   ========================================================= */

async function fetchDailyBrief() {
  const resp = await fetch('/api/rss').catch(() => null);
  if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status || 'error'}`);
  const data = await resp.json().catch(() => ({}));
  const items = Array.isArray(data.items) ? data.items : [];

  return items.map(normalizeItem);
}

function normalizeItem(raw) {
  const out = {
    title: raw.title || raw.headline || '',
    link: raw.link || raw.url || '#',
    pubDate: raw.pubDate || raw.date || raw.published_at || null,
    source: raw.source || raw.site || safeHost(raw.link),
    image: pickImage(raw)
  };
  return out;
}

function pickImage(it) {
  // 1) explicit field
  if (it.image && isHttp(it.image)) return it.image;

  // 2) media:thumbnail/media:content common names
  if (it.mediaThumbnail && isHttp(it.mediaThumbnail.url)) return it.mediaThumbnail.url;
  if (it.media && isHttp(it.media.url)) return it.media.url;

  // 3) RSS enclosure
  if (it.enclosure && isHttp(it.enclosure.url)) return it.enclosure.url;

  // 4) first <img> in description/summary
  const html = it.description || it.summary || '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && isHttp(m[1])) return m[1];

  // 5) fallback = app icon
  return '/icon-192.png';
}

function isHttp(u) { return typeof u === 'string' && /^https?:\/\//i.test(u); }
function safeHost(u){
  try{ return new URL(u).hostname.replace(/^www\./,''); }catch{ return ''; }
}

