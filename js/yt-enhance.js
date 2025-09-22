// js/yt-enhance.js
// LifeCre8 v1.10.0 — Enhance YouTube tiles with real titles/thumbnails

(function () {
  function $$(q, root = document) { return Array.from(root.querySelectorAll(q)); }

  async function fetchMeta(ids) {
    try {
      const url = `/api/youtube?ids=${encodeURIComponent(ids.join(','))}`;
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) return null;
      const j = await r.json();
      return j.items || null;
    } catch {
      return null;
    }
  }

  // Update a single tile’s list
  async function enhanceTile(tile) {
    const listEls = $$('.yt-item', tile);
    if (!listEls.length) return;

    const ids = listEls.map(el => el.dataset.vid).filter(Boolean);
    if (!ids.length) return;

    const meta = await fetchMeta(ids);
    if (!meta || !meta.length) return;

    const byId = new Map(meta.map(m => [m.id, m]));
    listEls.forEach(el => {
      const id = el.dataset.vid;
      const m = byId.get(id);
      if (!m) return;

      const titleEl = el.querySelector('.yt-title');
      if (titleEl) titleEl.textContent = m.title;

      const imgEl = el.querySelector('.yt-thumb');
      if (imgEl && m.thumb) imgEl.src = m.thumb;
    });
  }

  // Enhance all visible YouTube tiles
  async function run() {
    const tiles = $$('[data-yt]');
    if (!tiles.length) return;
    await Promise.all(tiles.map(enhanceTile));
  }

  // Re-run after your app renders sections
  document.addEventListener('DOMContentLoaded', run);
  // A tiny observer to catch re-renders
  const grid = document.getElementById('grid');
  if (grid) {
    const obs = new MutationObserver(() => run());
    obs.observe(grid, { childList: true, subtree: true });
  }
})();
