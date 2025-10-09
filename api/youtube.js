export const config = { runtime: "edge" };

const UA = "Mozilla/5.0 (compatible; LifeCre8 YouTube/1.0)";
const TIMEOUT_MS = 10000;
const ID_RE = /^[A-Za-z0-9_-]{6,}$/;

function withTimeout() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), TIMEOUT_MS);
  return { signal: ctrl.signal, cleanup: () => clearTimeout(t) };
}

function bestThumb(id) {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

async function fetchOEmbed(id) {
  const { signal, cleanup } = withTimeout();
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
    const res = await fetch(url, { headers: { "user-agent": UA }, signal });
    if (!res.ok) throw new Error(`oEmbed ${res.status}`);
    const j = await res.json();
    return { id, title: (j.title || "").trim() || `Video ${id}`, thumb: j.thumbnail_url || bestThumb(id) };
  } finally { cleanup(); }
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("ids") || "";
    const ids = raw.split(",").map(s => s.trim()).filter(s => ID_RE.test(s));

    if (!ids.length)
      return new Response(JSON.stringify({ items: [], note: "Pass ?ids=VIDEO_ID,..." }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" }, status: 200
      });

    const items = await Promise.all(ids.map(async id => {
      try { return await fetchOEmbed(id); }
      catch { return { id, title: `Video ${id}`, thumb: bestThumb(id) }; }
    }));

    return new Response(JSON.stringify({ items }), {
      headers: { "content-type": "application/json", "cache-control": "s-maxage=60, stale-while-revalidate=120" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ items: [], error: String(err) }), {
      headers: { "content-type": "application/json" }, status: 500
    });
  }
}
