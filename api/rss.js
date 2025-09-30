// api/rss.js — v1.3.0
// Robust RSS proxy: accepts ?url= or ?feed= (string) or ?feeds= (comma list)
// Tries feeds in order; returns the first that parses. Always returns JSON.

export const config = { runtime: 'edge' }; // fast + fetch available

const TEXT_OK = v => typeof v === 'string' && v.trim().length > 0;

// very small XML helpers (no external packages)
function between(xml, startTag, endTag) {
  const out = [];
  let i = 0;
  while (true) {
    const a = xml.indexOf(startTag, i);
    if (a === -1) break;
    const b = xml.indexOf(endTag, a + startTag.length);
    if (b === -1) break;
    out.push(xml.slice(a + startTag.length, b));
    i = b + endTag.length;
  }
  return out;
}
function decode(x='') {
  return x
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function firstTag(block, tag) {
  // returns innerText of first occurrence of <tag>…</tag> in a block
  const s = `<${tag}`;
  const i = block.indexOf(s);
  if (i === -1) return '';
  const closeStart = block.indexOf('>', i);
  if (closeStart === -1) return '';
  const endTag = `</${tag}>`;
  const j = block.indexOf(endTag, closeStart + 1);
  if (j === -1) return '';
  return decode(block.slice(closeStart + 1, j).trim());
}
function findImage(block) {
  // try common places
  const m1 = block.match(/<media:content[^>]+url="([^"]+)"/i);
  if (m1) return m1[1];
  const m2 = block.match(/<img[^>]+src="([^"]+)"/i);
  if (m2) return m2[1];
  const m3 = block.match(/<enclosure[^>]+url="([^"]+)"/i);
  if (m3) return m3[1];
  return '';
}

async function fetchText(url) {
  const c = await fetch(url, { headers: { 'user-agent':'Mozilla/5.0 LifeCre8' }, cache: 'no-store' });
  if (!c.ok) throw new Error(`HTTP ${c.status}`);
  return await c.text();
}

function parseRss(xml, feedUrl='') {
  // RSS 2.0 items
  let items = between(xml, '<item', '</item>').map(raw => {
    const title = firstTag(raw, 'title');
    const link  = firstTag(raw, 'link');
    const desc  = firstTag(raw, 'description');
    const pub   = firstTag(raw, 'pubDate') || firstTag(raw, 'updated') || '';
    const img   = findImage(raw);
    return { title, link, description: desc, pubDate: pub, image: img, source: hostOf(feedUrl) };
  }).filter(x => TEXT_OK(x.title) && TEXT_OK(x.link));

  // Atom fallback
  if (!items.length) {
    items = between(xml, '<entry', '</entry>').map(raw => {
      const title = firstTag(raw, 'title');
      let link = '';
      const m = raw.match(/<link[^>]+href="([^"]+)"/i);
      if (m) link = m[1];
      const pub = firstTag(raw, 'updated') || firstTag(raw, 'published') || '';
      const img = findImage(raw);
      return { title, link, pubDate: pub, image: img, source: hostOf(feedUrl) };
    }).filter(x => TEXT_OK(x.title) && TEXT_OK(x.link));
  }

  return items;
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } }

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const one = searchParams.get('url') || searchParams.get('feed');
    const list = searchParams.get('feeds');
    const feeds = [];

    if (one) feeds.push(one);
    if (list) list.split(',').map(s => s.trim()).filter(Boolean).forEach(f => feeds.push(f));
    if (!feeds.length) {
      return new Response(JSON.stringify({ items: [], note: 'no feed specified' }), {
        status: 400, headers: { 'content-type':'application/json; charset=utf-8' }
      });
    }

    // try feeds in order until one succeeds with items
    for (const f of feeds) {
      try {
        const xml = await fetchText(f);
        const items = parseRss(xml, f).slice(0, 20);
        if (items.length) {
          return new Response(JSON.stringify({ items }), {
            headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }
          });
        }
      } catch { /* try next */ }
    }

    return new Response(JSON.stringify({ items: [], error: 'parsed 0 items from all feeds' }), {
      status: 502, headers: { 'content-type':'application/json; charset=utf-8' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ items: [], error: String(err) }), {
      status: 500, headers: { 'content-type':'application/json; charset=utf-8' }
    });
  }
}
