// api/ai/summarize.js
// Input: { items: [{title, link, description, source, published, image, thumb}] }
// Output: { items: [{title, summary, image, source, time, link}] }
// Deterministic fallback implementation (no external AI call).
// Later you can swap in an LLM behind the same schema.

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const { items = [] } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.json({ items: [] });
    }

    const out = items.slice(0, 12).map(it => {
      const cleanTitle = clean((it.title || "").trim()).slice(0, 160);
      const summary = summarizeTo1Line(it);
      const img = it.image || it.thumb || null; // keep any image parsed by /api/rss
      const source = (it.source || "").trim();
      const time = relativeTime(it.published || it.pubDate || it.date || null);
      return {
        title: cleanTitle || "Untitled",
        summary,
        image: img,
        source,
        time,
        link: it.link || "#"
      };
    });

    res.json({ items: out });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}

function clean(htmlish){
  return (htmlish||"").replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
}
function summarizeTo1Line(it){
  // crude, safe summary: prefer description; otherwise use truncated title.
  const d = clean(it.description || it.content || "");
  if (d) return d.length > 160 ? d.slice(0,157) + "…" : d;
  const t = clean(it.title || "");
  return t.length > 140 ? t.slice(0,137) + "…" : t;
}
function relativeTime(dateLike){
  const d = dateLike ? new Date(dateLike) : null;
  if (!d || isNaN(d)) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h/24);
  return `${days}d ago`;
}
