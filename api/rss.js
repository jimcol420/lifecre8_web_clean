// /api/rss.js  — fetches an RSS/Atom feed server-side and returns JSON
export const config = { runtime: 'edge' }; // fast, no cold starts

function textBetween(xml, startTag, endTag) {
  const s = xml.indexOf(startTag);
  if (s === -1) return null;
  const e = xml.indexOf(endTag, s + startTag.length);
  if (e === -1) return null;
  return xml.slice(s + startTag.length, e).trim();
}

function strip(html) {
  return html
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseItems(xml) {
  // Try RSS <item>
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[0];
    const title = strip(textBetween(block, '<title>', '</title>') || '');
    const link  = strip(textBetween(block, '<link>', '</link>') || '');
    const date  = strip(textBetween(block, '<pubDate>', '</pubDate>') || textBetween(block, '<updated>', '</updated>') || '');
    const source = strip(textBetween(xml, '<title>', '</title>') || '');
    items.push({ title, link, time: date, source });
  }
  if (items.length) return items;

  // Fallback Atom <entry>
  const entries = [];
  const entryRegex = /<entry[\s\S]*?<\/entry>/gi;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[0];
    const title = strip(textBetween(block, '<title>', '</title>') || '');
    const linkTag = block.match(/<link[^>]*href="([^"]+)"/i);
    const link  = linkTag ? linkTag[1] : '';
    const date  = strip(textBetween(block, '<updated>', '</updated>') || textBetween(block, '<published>', '</published>') || '');
    const source = strip(textBetween(xml, '<title>', '</title>') || '');
    entries.push({ title, link, time: date, source });
  }
  return entries;
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) {
    return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (LifeCre8 RSS)' } });
    if (!r.ok) throw new Error(`Upstream ${r.status}`);
    const xml = await r.text();
    const items = parseItems(xml).slice(0, 15);
    return new Response(JSON.stringify({ items }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 's-maxage=600, stale-while-revalidate=300'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
}
