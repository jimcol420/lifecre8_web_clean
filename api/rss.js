// api/rss.js — v1.3.1 (BBC thumbnails + more)
// Edge runtime; always returns JSON; accepts ?url=, ?feed=, or ?feeds=a,b,c

export const config = { runtime: 'edge' };

const isStr = v => typeof v === 'string' && v.trim().length > 0;

function between(xml, startTag, endTag) {
  const out = []; let i = 0;
  while (true) {
    const a = xml.indexOf(startTag, i); if (a === -1) break;
    const b = xml.indexOf(endTag, a + startTag.length); if (b === -1) break;
    out.push(xml.slice(a + startTag.length, b)); i = b + endTag.length;
  }
  return out;
}
function decode(x='') {
  return x.replace(/<!\[CDATA\[(.*?)\]\]>/gs,'$1')
          .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function firstTag(block, tag) {
  const s = `<${tag}`; const i = block.indexOf(s); if (i === -1) return '';
  const close = block.indexOf('>', i); if (close === -1) return '';
  const end = block.indexOf(`</${tag}>`, close + 1); if (end === -1) return '';
  return decode(block.slice(close + 1, end).trim());
}
function relTime(iso) {
  const t = Date.parse(iso || '') || Date.parse(iso?.replace?.(/GMT.*/,'') || '') || 0;
  if (!t) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s<60) return `${s}s ago`; const m=Math.floor(s/60);
  if (m<60) return `${m}m ago`; const h=Math.floor(m/60);
  if (h<48) return `${h}h ago`; const d=Math.floor(h/24);
  return `${d}d ago`;
}
function firstMatch(re, s){ const m = s.match(re); return m ? m[1] : ''; }

function findImage(block) {
  // Most common:
  let url =
    // BBC & many: <media:thumbnail url="…">
    firstMatch(/<media:thumbnail[^>]+url="([^"]+)"/i, block) ||
    // <media:content url="…">
    firstMatch(/<media:content[^>]+url="([^"]+)"/i, block) ||
    // <enclosure url="…">
    firstMatch(/<enclosure[^>]+url="([^"]+)"/i, block) ||
    // <img src="…"> inside description/content
    firstMatch(/<img[^>]+src="([^"]+)"/i, block);

  // Clean protocol-less URLs //example.com/x.jpg
  if (url && url.startsWith('//')) url = 'https:' + url;
  return url || '';
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent':'Mozilla/5.0 LifeCre8' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
function hostOf(u){ try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } }

function parse(xml, feedUrl='') {
  let items = between(xml, '<item', '</item>').map(raw => {
    const title = firstTag(raw,'title');
    const link  = firstTag(raw,'link') || firstMatch(/<link[^>]+href="([^"]+)"/i, raw);
    const pub   = firstTag(raw,'pubDate') || firstTag(raw,'updated') || firstTag(raw,'published');
    const desc  = firstTag(raw,'description') || firstTag(raw,'content:encoded');
    const image = findImage(raw) || findImage(desc || '');
    return { title, link, description: decode(desc||''), image, source: hostOf(feedUrl), time: relTime(pub) };
  }).filter(x => isStr(x.title) && isStr(x.link));

  if (!items.length) {
    items = between(xml, '<entry', '</entry>').map(raw => {
      const title = firstTag(raw,'title');
      const link  = firstMatch(/<link[^>]+href="([^"]+)"/i, raw);
      const pub   = firstTag(raw,'updated') || firstTag(raw,'published');
      const cont  = firstTag(raw,'content') || firstTag(raw,'summary');
      const image = findImage(raw) || findImage(cont || '');
      return { title, link, description: decode(cont||''), image, source: hostOf(feedUrl), time: relTime(pub) };
    }).filter(x => isStr(x.title) && isStr(x.link));
  }
  return items.slice(0, 20);
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const one  = searchParams.get('url') || searchParams.get('feed');
    const list = searchParams.get('feeds');
    const feeds = [];
    if (one) feeds.push(one);
    if (list) list.split(',').map(s=>s.trim()).filter(Boolean).forEach(f=>feeds.push(f));
    if (!feeds.length) {
      return new Response(JSON.stringify({ items: [], note:'no feed specified' }), {
        status: 400, headers: { 'content-type':'application/json; charset=utf-8' }
      });
    }

    for (const f of feeds) {
      try {
        const xml = await fetchText(f);
        const items = parse(xml, f);
        if (items.length) {
          return new Response(JSON.stringify({ items }), {
            headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }
          });
        }
      } catch { /* try next feed */ }
    }

    return new Response(JSON.stringify({ items: [], error:'no items parsed' }), {
      status: 502, headers: { 'content-type':'application/json; charset=utf-8' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ items: [], error:String(e) }), {
      status: 500, headers: { 'content-type':'application/json; charset=utf-8' }
    });
  }
}
